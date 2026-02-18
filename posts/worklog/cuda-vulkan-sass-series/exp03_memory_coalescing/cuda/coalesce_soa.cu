// coalesce_soa.cu — Read x field from SoA layout.
// float x[N], y[N], z[N], w[N] — contiguous access, perfect coalescing.

extern "C" __global__ void read_soa_x(const float* x, float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = x[idx];
    }
}
