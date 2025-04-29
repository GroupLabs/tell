# Getting started
> Please ensure you are using the latest cargo

This project now supports a one step command build process:

`docker compose up -d`

If the backend image needs to be rebuilt (such as on a code change), simply add the build flag like so:

`docker compose up -d --build`

> Please note that the current Dockerfile compiles in release mode. This may increase the compile time, so it is reccomended to use the development workflow during development.

This will start the necessary containers. It may take some time for the server to start. Here are the exposed ports of interest:

- 3000: server
- 3001: Grafana
- 9090: prometheus

To use the server, a user can
- upload a file with `curl -X POST -F 'file=@<filename>.html' http://localhost:8000/html/upload` which will return a UUID [^1];
- view the uploaded file at `localhost:8000/html/<UUID>`;
- access an llm api through `localhost:8000/llm/generate/`. More info on usage below;
- check the server status at `localhost:8000/`

[^1]: An example HTML file is given in the root directory. To use the example, run `curl -X POST -F 'file=@index.html' http://localhost:3000/upload`.

## LLM

To use the generate endpoint, the `x-api-key` header, and the required fields in the data object need to be passed. Here is a minimal example:

```
curl -X POST http://localhost:8000/llm/generate \
     --header "x-api-key: <API-KEY>" \
     --data '{
    "model": "claude-3-5-sonnet-20240620",
    "max_tokens": 256,
    "messages": [
        {"role": "user", "content": "Hello, world"}
    ]
}'
```

Further, the `anthropic-version`, and the `Content-Type` headers may also be set:

```
curl -X POST http://localhost:8000/llm/generate \
     --header "anthropic-version: 2023-06-01" \
     --header "Content-Type: application/json" \
     --header "x-api-key: <API-KEY>" \
     --data '{
    "model": "claude-3-5-sonnet-20240620",
    "max_tokens": 256,
    "messages": [
        {"role": "user", "content": "Hello, world"}
    ]
}'
```

Finally, to enable streaming, use add `"stream": true` to the data object.

```
curl -X POST http://localhost:8000/llm/generate \
     --header "anthropic-version: 2023-06-01" \
     --header "Content-Type: application/json" \
     --header "x-api-key: <API-KEY>" \
     --data '{
    "model": "claude-3-5-sonnet-20240620",
    "max_tokens": 256,
    "stream": true,
    "messages": [
        {"role": "user", "content": "Hello, world"}
    ]
}'
```

## Vercel AI SDK

Some applications will require the vercel ai sdk. To accomodate, this application includes an optional node sidecar.

The server will automatically reroute any requests to the node sidecar, if an `id` field is present.

To run, fill out the environment variables in the `.env` file. An example is given. Then, install the required dependencies with `npm i` in the root folder. Finally, in the `sidecar(ai-sdk)` folder, start the express server with `node sidecar.js`.

## Logging

By default, the logs are set to the `WARNING` level. This means that only `WARN` or `ERROR` messages will be displayed.

To see `INFO` level logs, set `RUST_LOG=info` in the environment. Or, simply do `RUST_LOG=info cargo run`.

## Metrics

The server includes a `/metrics` endpoint which collects various streams of metrics about the server.

Further, both Prometheus and Grafana are available at the respective ports. See `http://localhost:9090/targets?search=` for all the available targets.

To use Grafana, open the port that it's running on in a browser. The username and password will both be 'admin'.
Configure a new data source by going to the hamburger menu/connections/data sources. Select Prometheus. Use `http://prometheus:9090` as the server URL.

Now to build a dashboard, go back to the home view. Then, click the plus icon in the top right, and import a dashboard. Use the ID `1860` to import the node exporter dashboard. Use the previously configured prometheus data source.

# Development

The server can also be started outside of a Docker environment, by simply running `cargo run` in `backend/` directory. This will have a metrics endpoint, but it will not be aggregated into a Grafana dashboard unless the appropriate services are started as well. Also please note that there may be some improvements when using the release flag.

# Benchmarks

## Server

A baseline Python server is also provided. Firstly, install all the required dependencies to a virtual environment.

Then, start the server with `uvicorn server:app --reload` in the `backend/py-baseline/src/` directory.

This will start a highly performant Python server that mimics the health, upload, and view html endpoints. However, it is a translation of the main.rs code provided by an AI model, so it may not be as optimized as possible.
