use std::env;

use actix_cors::Cors;
use actix_web::{middleware::Logger, web, App, Error, HttpResponse, HttpServer, Responder};
use actix_web_prom::PrometheusMetricsBuilder;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use reqwest::Client;
use tokio_stream::StreamExt;

use bytes::Bytes;
use log::{error, info};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Load .env file
    dotenv::dotenv().ok();

    env_logger::init();

    // metrics
    let prometheus = PrometheusMetricsBuilder::new("api")
        .endpoint("/metrics")
        .build()
        .unwrap();

    HttpServer::new(move || {
        App::new()
            .wrap(Logger::default())
            .wrap(prometheus.clone())
            .wrap(
                Cors::default()
                    .allowed_origin("http://localhost:3000")
                    .allowed_origin("http://localhost:5173")
                    .allowed_methods(vec!["GET", "POST", "OPTIONS"])
                    .allowed_headers(vec![
                        actix_web::http::header::CONTENT_TYPE,
                        actix_web::http::header::AUTHORIZATION,
                        actix_web::http::header::ORIGIN,
                    ])
                    .expose_headers(vec![actix_web::http::header::CONTENT_TYPE])
                    .supports_credentials()
                    .max_age(3600),
            )
            .route("/", web::get().to(health_check))
            .route("/health", web::get().to(health_check))
            .route(
                "/metrics",
                web::get().to(|| async { HttpResponse::Ok().finish() }),
            )
            .route("/sdk-chat", web::post().to(sdk_chat))
            .default_service(web::route().to(not_found))
    })
    .bind("0.0.0.0:3010")?
    .run()
    .await
}

async fn health_check() -> impl Responder {
    HttpResponse::Ok().body("healthy")
}

async fn not_found() -> impl Responder {
    HttpResponse::NotFound().body("Not found")
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatRequest {
    messages: Vec<ChatMessage>,
    #[serde(default = "default_model")]
    model: String,
    #[serde(default = "default_temperature")]
    temperature: f32,
    #[serde(default, rename = "maxSteps")]
    max_steps: Option<u32>,
}

fn default_model() -> String {
    "claude-3-5-sonnet-20241022".to_string()
}

fn default_temperature() -> f32 {
    0.2
}

#[derive(Debug, Serialize)]
struct ToolInputSchema {
    #[serde(rename = "type")]
    schema_type: String,
    properties: serde_json::Map<String, Value>,
    required: Vec<String>,
}

#[derive(Debug, Serialize)]
struct Tool {
    name: String,
    description: String,
    input_schema: ToolInputSchema,
}

fn create_tools() -> Vec<Tool> {
    let mut execute_sql_properties = serde_json::Map::new();
    execute_sql_properties.insert(
        "sql".to_string(),
        json!({
            "type": "string",
            "description": "The complete DuckDB-compatible SQL query. CRITICAL: Use proper SQL syntax only - no English phrases! Use: = (not 'equals'), < (not 'less than'), > (not 'greater than'), BETWEEN x AND y (not 'IS BETWEEN' or 'is around'), LIKE '%pattern%' (not 'contains'), IS NULL/IS NOT NULL only. Example: WHERE age BETWEEN 20 AND 30 (correct), NOT WHERE age IS BETWEEN 20 AND 30 (wrong)"
        })
    );

    let mut add_transformation_properties = serde_json::Map::new();
    add_transformation_properties.insert(
        "sql".to_string(),
        json!({
            "type": "string",
            "description": "The SQL query for the transformation. Use 'previous_step' to reference the output of the last transformation, or reference other transformation outputs by their alias names."
        })
    );
    add_transformation_properties.insert(
        "outputAlias".to_string(),
        json!({
            "type": "string",
            "description": "A meaningful name for this transformation step using underscores (e.g., 'filtered_data', 'high_value_orders', 'aggregated_results')"
        })
    );

    vec![
        Tool {
            name: "executeSQL".to_string(),
            description: "Run a SQL query for immediate results without adding it to the transformation pipeline. Use for exploratory queries, data inspection, or when users want to see results right away.".to_string(),
            input_schema: ToolInputSchema {
                schema_type: "object".to_string(),
                properties: execute_sql_properties,
                required: vec!["sql".to_string()],
            },
        },
        Tool {
            name: "addTransformation".to_string(),
            description: "Add a SQL transformation step to the data pipeline. Use when users want to filter, transform, or process data as part of their workflow.".to_string(),
            input_schema: ToolInputSchema {
                schema_type: "object".to_string(),
                properties: add_transformation_properties,
                required: vec!["sql".to_string(), "outputAlias".to_string()],
            },
        },
    ]
}

async fn sdk_chat(body: web::Bytes) -> Result<HttpResponse, Error> {
    info!("Raw request body: {}", String::from_utf8_lossy(&body));

    let request: ChatRequest = serde_json::from_slice(&body)
        .map_err(|e| actix_web::error::ErrorBadRequest(format!("Invalid JSON: {}", e)))?;

    info!("Parsed request: model={}, messages={}, temperature={}, max_steps={:?}",
          request.model, request.messages.len(), request.temperature, request.max_steps);

    // Determine provider based on model name
    let is_claude = request.model.to_lowercase().starts_with("claude");

    if is_claude {
        handle_anthropic_request(request).await
    } else {
        handle_openai_request(request).await
    }
}

async fn handle_anthropic_request(request: ChatRequest) -> Result<HttpResponse, Error> {
    // Mock response disabled - using actual API

    let api_key = env::var("ANTHROPIC_API_KEY")
        .map_err(|_| actix_web::error::ErrorInternalServerError("ANTHROPIC_API_KEY not set"))?;

    let client = Client::new();
    let tools = create_tools();

    // Convert messages to Anthropic format
    let messages: Vec<Value> = request
        .messages
        .into_iter()
        .map(|msg| {
            json!({
                "role": msg.role,
                "content": msg.content
            })
        })
        .collect();

    let mut request_body = json!({
        "model": request.model,
        "messages": messages,
        // "temperature": request.temperature,
        "stream": true,
        "max_tokens": 4096
    });

    // Add tools if any
    if !tools.is_empty() {
        request_body["tools"] = json!(tools);
        info!("Added {} tools to Anthropic request", tools.len());
        info!("Tools: {}", serde_json::to_string_pretty(&tools).unwrap_or_default());
        if let Some(max_steps) = request.max_steps {
            request_body["max_tokens"] = json!(max_steps * 1000); // Rough estimation
        }
    }

    info!("Sending request to Anthropic: {}", serde_json::to_string_pretty(&request_body).unwrap_or_default());

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Anthropic-Version", "2023-06-01")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            error!("Failed to call Anthropic API: {}", e);
            actix_web::error::ErrorBadGateway(format!("Anthropic API error: {}", e))
        })?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        error!("Anthropic API error {}: {}", status, error_text);
        return Err(actix_web::error::ErrorBadGateway(format!(
            "Anthropic API error: {}",
            status
        )));
    }

    // Convert Anthropic streaming response to AI SDK format
    let stream = response.bytes_stream();
    let ai_sdk_stream = stream.map(|chunk_result| {
        match chunk_result {
            Ok(chunk) => {
                // Parse Anthropic SSE format and convert to AI SDK format
                let chunk_str = String::from_utf8_lossy(&chunk);
                info!("Anthropic raw chunk: {}", chunk_str);
                let converted = convert_anthropic_to_ai_sdk(&chunk_str);
                if !converted.is_empty() {
                    info!("Converted to AI SDK: {}", converted);
                }
                Ok::<Bytes, reqwest::Error>(Bytes::from(converted))
            }
            Err(e) => {
                let error_msg = format!(
                    "data: {{\"type\":\"error\",\"error\":\"Stream error: {}\"}}\n\n",
                    e
                );
                Ok(Bytes::from(error_msg))
            }
        }
    });

    Ok(HttpResponse::Ok()
        .insert_header(("Content-Type", "text/event-stream"))
        .insert_header(("Cache-Control", "no-cache"))
        .insert_header(("Connection", "keep-alive"))
        .insert_header(("Access-Control-Allow-Origin", "*"))
        .streaming(ai_sdk_stream))
}

async fn handle_openai_request(request: ChatRequest) -> Result<HttpResponse, Error> {
    let api_key = env::var("OPENAI_API_KEY")
        .map_err(|_| actix_web::error::ErrorInternalServerError("OPENAI_API_KEY not set"))?;

    let client = Client::new();
    let tools = create_tools();

    // Convert messages to OpenAI format
    let messages: Vec<Value> = request
        .messages
        .into_iter()
        .map(|msg| {
            json!({
                "role": msg.role,
                "content": msg.content
            })
        })
        .collect();

    let mut request_body = json!({
        "model": request.model,
        "messages": messages,
        "stream": true
    });

    // Only add temperature for models that support it
    // o1, o3, and gpt-5 models don't support custom temperature
    let is_o1_or_o3_model = request.model.starts_with("o1") || request.model.starts_with("o3");
    let is_gpt5_model = request.model.starts_with("gpt-5");

    // Only add temperature for models that support it
    if !is_o1_or_o3_model && !is_gpt5_model && request.temperature != 0.0 {
        request_body["temperature"] = json!(request.temperature);
    }
    // Don't send temperature parameter for o1, o3, or gpt-5 models at all

    // Add tools if any (convert to OpenAI function format)
    // o1 and o3 models don't support tools
    if !tools.is_empty() && !is_o1_or_o3_model {
        let openai_tools: Vec<Value> = tools
            .into_iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema
                    }
                })
            })
            .collect();
        request_body["tools"] = json!(openai_tools);
        info!("Added {} tools to OpenAI request", openai_tools.len());
        info!("Tools: {}", serde_json::to_string_pretty(&openai_tools).unwrap_or_default());
    }

    info!("Sending request to OpenAI: {}", serde_json::to_string_pretty(&request_body).unwrap_or_default());

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            error!("Failed to call OpenAI API: {}", e);
            actix_web::error::ErrorBadGateway(format!("OpenAI API error: {}", e))
        })?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        error!("OpenAI API error {}: {}", status, error_text);
        return Err(actix_web::error::ErrorBadGateway(format!(
            "OpenAI API error: {}",
            status
        )));
    }

    // Convert OpenAI streaming response to AI SDK format
    let stream = response.bytes_stream();
    let ai_sdk_stream = stream.map(|chunk_result| {
        match chunk_result {
            Ok(chunk) => {
                // Parse OpenAI SSE format and convert to AI SDK format
                let chunk_str = String::from_utf8_lossy(&chunk);
                info!("OpenAI raw chunk: {}", chunk_str);
                let converted = convert_openai_to_ai_sdk(&chunk_str);
                if !converted.is_empty() {
                    info!("Converted to AI SDK: {}", converted);
                }
                Ok::<Bytes, reqwest::Error>(Bytes::from(converted))
            }
            Err(e) => {
                let error_msg = format!(
                    "data: {{\"type\":\"error\",\"error\":\"Stream error: {}\"}}\n\n",
                    e
                );
                Ok(Bytes::from(error_msg))
            }
        }
    });

    Ok(HttpResponse::Ok()
        .insert_header(("Content-Type", "text/event-stream"))
        .insert_header(("Cache-Control", "no-cache"))
        .insert_header(("Connection", "keep-alive"))
        .insert_header(("Access-Control-Allow-Origin", "*"))
        .streaming(ai_sdk_stream))
}

fn convert_anthropic_to_ai_sdk(chunk: &str) -> String {
    // Convert Anthropic streaming format to AI SDK v5 format
    let mut result = String::new();

    for line in chunk.lines() {
        if line.starts_with("data: ") {
            let data_part = &line[6..];
            if data_part == "[DONE]" {
                // No special end marker needed in AI SDK v5
                continue;
            }

            if let Ok(parsed) = serde_json::from_str::<Value>(data_part) {
                info!("Anthropic parsed data: {}", serde_json::to_string(&parsed).unwrap_or_default());
                // Convert Anthropic delta format to AI SDK v5 format
                if let Some(event_type) = parsed.get("type").and_then(|t| t.as_str()) {
                    match event_type {
                        "content_block_delta" => {
                            if let Some(delta) = parsed.get("delta") {
                                if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                    info!("Anthropic text delta: {}", text);
                                    // AI SDK v5 format: 0:"text content"
                                    result.push_str(&format!(
                                        "0:{}\n",
                                        serde_json::to_string(text).unwrap_or_default()
                                    ));
                                }
                            }
                        }
                        "message_stop" => {
                            // No special end marker needed in AI SDK v5
                        }
                        _ => {
                            // Skip other events for now
                        }
                    }
                }
            }
        }
    }

    result
}

// Store tool call accumulator state
use std::collections::HashMap;
use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref TOOL_CALLS: Mutex<HashMap<String, ToolCallAccumulator>> = Mutex::new(HashMap::new());
}

#[derive(Debug, Clone)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

fn convert_openai_to_ai_sdk(chunk: &str) -> String {
    // Convert OpenAI streaming format to AI SDK v5 format
    let mut result = String::new();

    for line in chunk.lines() {
        if line.starts_with("data: ") {
            let data_part = &line[6..];
            if data_part == "[DONE]" {
                // Send accumulated tool calls when done
                let mut tool_calls = TOOL_CALLS.lock().unwrap();
                for (_, tool_call) in tool_calls.drain() {
                    // Parse the complete arguments
                    let args = serde_json::from_str::<Value>(&tool_call.arguments)
                        .unwrap_or_else(|_| json!({}));

                    info!("Sending tool call: id={}, name={}, args={}",
                          tool_call.id, tool_call.name, tool_call.arguments);

                    // Send complete tool call in AI SDK format
                    result.push_str(&format!(
                        "9:{}\n",
                        serde_json::to_string(&json!({
                            "toolCallId": tool_call.id,
                            "toolName": tool_call.name,
                            "args": args
                        })).unwrap_or_default()
                    ));
                }
                continue;
            }

            if let Ok(parsed) = serde_json::from_str::<Value>(data_part) {
                info!("OpenAI parsed data: {}", serde_json::to_string(&parsed).unwrap_or_default());
                // Convert OpenAI delta format to AI SDK v5 format
                if let Some(choices) = parsed.get("choices").and_then(|c| c.as_array()) {
                    if let Some(choice) = choices.first() {
                        if let Some(delta) = choice.get("delta") {
                            // Handle text content
                            if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                // AI SDK v5 format: 0:"text content"
                                result.push_str(&format!(
                                    "0:{}\n",
                                    serde_json::to_string(content).unwrap_or_default()
                                ));
                            }

                            // Handle tool calls
                            if let Some(tool_calls) = delta.get("tool_calls").and_then(|t| t.as_array()) {
                                info!("Found tool_calls in delta: {:?}", tool_calls);
                                let mut tc_map = TOOL_CALLS.lock().unwrap();

                                for tool_call in tool_calls {
                                    let index = tool_call.get("index")
                                        .and_then(|i| i.as_u64())
                                        .unwrap_or(0);
                                    let key = format!("tc_{}", index);

                                    // First chunk has id, type and function name
                                    if let Some(id) = tool_call.get("id").and_then(|i| i.as_str()) {
                                        if let Some(function) = tool_call.get("function") {
                                            let name = function.get("name")
                                                .and_then(|n| n.as_str())
                                                .unwrap_or("");
                                            let arguments = function.get("arguments")
                                                .and_then(|a| a.as_str())
                                                .unwrap_or("");

                                            info!("Tool call init: id={}, name={}, args_start={}",
                                                  id, name, arguments);

                                            tc_map.insert(key.clone(), ToolCallAccumulator {
                                                id: id.to_string(),
                                                name: name.to_string(),
                                                arguments: arguments.to_string(),
                                            });
                                        }
                                    } else if let Some(function) = tool_call.get("function") {
                                        // Subsequent chunks only have incremental arguments
                                        if let Some(arguments) = function.get("arguments").and_then(|a| a.as_str()) {
                                            if let Some(tc) = tc_map.get_mut(&key) {
                                                tc.arguments.push_str(arguments);
                                                info!("Tool call append: key={}, args_chunk={}",
                                                      key, arguments);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    result
}
