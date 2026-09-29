# AEGIS local vision model

- File: `aegis-vision.onnx`
- Base: SqueezeNet 1.1 (ONNX Model Zoo `squeezenet1.1-7.onnx`)
- Size: ~4.8 MB
- Role: on-device visual grounding backbone + spatial region proposals
- Loaded only from extension package (no runtime remote model download for demo)

Page pixels never leave the device for inference.
