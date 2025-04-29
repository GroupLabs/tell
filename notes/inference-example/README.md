# tell
llms for production

## Inference

In the burn/ repo, there are benchmarks available for different backends. This will allow you to compare different operations and available backends.

- list: `cargo run --release --bin burnbench -- list`
- bench: `cargo run --release --bin burnbench -- run -b unary -B wgpu-fusion`
