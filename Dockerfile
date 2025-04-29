# Use Ubuntu as the base image
FROM ubuntu:22.04

# Install necessary packages for Rust, OpenSSL, and other build essentials
RUN apt-get update && \
    apt-get install -y curl build-essential libssl-dev pkg-config ca-certificates git && \
    rm -rf /var/lib/apt/lists/*

# Install Rust using rustup
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y

# Add Rust to PATH
ENV PATH="/root/.cargo/bin:${PATH}"

# Set the working directory
WORKDIR /usr/src/app

# Copy the Cargo.toml and Cargo.lock files first to leverage Docker's build cache
COPY Cargo.toml ./

# Copy the source code into the container
COPY . .

# Build dependencies first (this step is cached if dependencies don't change)
RUN cargo build --release

# Expose the application port (make sure this matches the port used in your Actix Web server)
EXPOSE 8000

# Set environment variable for logging (optional)
ENV RUST_LOG=info

# Run the application
CMD ["cargo", "run", "--release"]
