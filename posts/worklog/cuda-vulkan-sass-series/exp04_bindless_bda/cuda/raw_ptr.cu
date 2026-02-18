// raw_ptr.cu — CUDA kernel that takes a raw device pointer.
// This is the natural CUDA way: pointer arithmetic, no descriptors.

extern "C" __global__ void read_via_pointer(const float* data, float* out,
                                             int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = data[idx] * 2.0f;
    }
}
