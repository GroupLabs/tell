use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use actix_cors::Cors;
use actix_web::{web, App, Error, HttpRequest, HttpResponse, HttpServer, Responder};
use actix_web_prom::PrometheusMetricsBuilder;

use serde_json::Value;

use awc::{error::PayloadError, Client, ClientResponse};

use futures_util::stream::Stream;

use bytes::Bytes;
use log::{error, info};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();

    // metrics
    let prometheus = PrometheusMetricsBuilder::new("api")
        .endpoint("/metrics")
        .build()
        .unwrap();

    HttpServer::new(move || {
        App::new()
            .wrap(prometheus.clone())
            .wrap(
                Cors::default()
                    .allowed_origin("http://localhost:3000")
                    .allowed_methods(vec!["GET", "POST"])
                    .allowed_headers(vec![
                        actix_web::http::header::CONTENT_TYPE,
                        actix_web::http::header::AUTHORIZATION,
                        actix_web::http::header::ACCEPT_ENCODING,
                    ])
                    .expose_headers(vec![
                        actix_web::http::header::CONTENT_TYPE,
                    ])
                    .supports_credentials()
                    .max_age(3600),
            )
            .route("/", web::get().to(health_check))
            .route("/health", web::get().to(health_check))
            .route("/metrics", web::get().to(|| async { HttpResponse::Ok().finish() }))
            .route("/llm/generate", web::post().to(generate))
            .default_service(web::route().to(not_found))
    })
    .bind("0.0.0.0:8000")?
    .run()
    .await
}

async fn health_check() -> impl Responder {
    info!("Health check called");
    HttpResponse::Ok().body("healthy")
}

async fn not_found() -> impl Responder {
    error!("404 - Not Found");
    HttpResponse::NotFound().body("Not found")
}

pub async fn generate(req: HttpRequest, body: Bytes) -> Result<HttpResponse, Error> {
    let json: Value = serde_json::from_slice(&body)
        .map_err(|e| actix_web::error::ErrorBadRequest(format!("invalid json: {e}")))?;

    let has_id = json.get("id").is_some();

    let clean_body = Bytes::from(serde_json::to_vec(&json)?);

    let target_url = if has_id {
        "http://localhost:3010/sdk-chat"
    } else {
        "https://api.openai.com/v1/chat/completions"
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(90))
        .finish();

    let mut fwd = client
        .post(target_url)
        .insert_header(("content-type", "application/json"));

    if let Some(h) = req.headers().get("authorization") {
        fwd = fwd.insert_header(("authorization", h.clone()));
    }
    if let Some(org) = req.headers().get("openai-organization") {
        fwd = fwd.insert_header(("openai-organization", org.clone()));
    }

    // Force uncompressed response from upstream
    fwd = fwd.insert_header(("accept-encoding", "identity"));

    info!("Forwarding to {}", target_url);
    let res = fwd.send_body(clean_body).await.map_err(|e| {
        error!("Forwarding failed: {e}");
        actix_web::error::ErrorBadGateway(format!("forwarding failed: {e}"))
    })?;

    // Build a new response without copying Content-Encoding headers
    let mut client_resp = HttpResponse::build(res.status());
    for (k, v) in res.headers() {
        let header_name = k.as_str().to_lowercase();
        // Skip problematic headers that could cause encoding conflicts
        if header_name != "content-encoding" && header_name != "transfer-encoding" {
            client_resp.append_header((k.clone(), v.clone()));
        }
    }

    // Ensure the content-type is set properly
    client_resp.append_header(("content-type", "application/json"));

    // Use a stream handler that captures the full response first
    Ok(client_resp.streaming(ResponseCollector::new(res)))
}

struct ResponseCollector<B> {
    inner: ClientResponse<B>,
}

impl<B> ResponseCollector<B> {
    fn new(res: ClientResponse<B>) -> Self {
        Self { inner: res }
    }
}

impl<B> Stream for ResponseCollector<B>
where
    B: Stream<Item = Result<Bytes, PayloadError>> + Unpin,
{
    type Item = Result<Bytes, Error>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match Pin::new(&mut self.get_mut().inner).poll_next(cx) {
            Poll::Ready(Some(Ok(bytes))) => {
                // Return the bytes as-is without any transformation
                Poll::Ready(Some(Ok(bytes)))
            }
            Poll::Ready(Some(Err(e))) => {
                error!("Error in response stream: {e}");
                Poll::Ready(Some(Err(actix_web::error::ErrorBadGateway(e))))
            }
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}
