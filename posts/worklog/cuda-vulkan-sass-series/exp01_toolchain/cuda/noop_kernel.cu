// noop_kernel.cu — Minimal CUDA kernel for toolchain inspection.
// Generates PTX → SASS with zero computation for pure overhead analysis.

extern "C" __global__ void noop_kernel() {
    // Intentionally empty — the SASS output reveals the prologue/epilogue
    // instructions that the NVIDIA compiler always emits.
}
