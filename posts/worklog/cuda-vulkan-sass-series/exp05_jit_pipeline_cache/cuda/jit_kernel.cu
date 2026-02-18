// jit_kernel.cu — Simple kernel for JIT compilation measurement.
// When loaded from PTX (not cubin), the CUDA driver JIT-compiles to SASS.

extern "C" __global__ void jit_scale(float* data, float factor, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        data[idx] *= factor;
    }
}
