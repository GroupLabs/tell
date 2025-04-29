use burn::tensor::Tensor as BurnTensor;
use burn_tch::{LibTorch, LibTorchDevice};
use tch::{CModule, Device, Tensor};

fn main() {
    println!("\n\n");

    let model_output = load_and_run_model("simple_model.pt", Device::Cpu);
    println!("TorchScript Model Output: {:?}", model_output);

    println!("\n\n");

    let result = create_and_multiply_tensors();
    println!("Element-wise multiplication result:\n{}", result);
}

fn load_and_run_model(model_path: &str, device: Device) -> Tensor {
    // load torchscript model
    let model = CModule::load(model_path).expect("Failed to load TorchScript model");

    // sample input
    let input_tensor = Tensor::ones(&[3, 3, 3, 3], (tch::Kind::Float, device));

    // run model
    let output = model.forward_ts(&[input_tensor]).unwrap();

    println!("Output shape: {:?}", output.size());
    output
}

fn create_and_multiply_tensors() -> BurnTensor<LibTorch<f32>, 2> {
    let device = LibTorchDevice::Cpu;

    let tensor_1 =
        BurnTensor::<LibTorch<f32>, 2>::from_data([[1223., 3663.], [2176., 2616.]], &device);
    let tensor_3 =
        BurnTensor::<LibTorch<f32>, 2>::from_data([[12., 3621.], [3728., 73827.]], &device);

    let result = tensor_1 * tensor_3;
    result
}
