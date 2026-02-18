#include "cuda_context.h"
#include <cstdio>
#include <cstdlib>
#include <stdexcept>

#define CU_CHECK(call)                                                     \
    do {                                                                   \
        CUresult r = (call);                                               \
        if (r != CUDA_SUCCESS) {                                           \
            const char* errStr = nullptr;                                  \
            cuGetErrorString(r, &errStr);                                  \
            fprintf(stderr, "CUDA Driver error %d (%s) at %s:%d\n", r,    \
                    errStr ? errStr : "unknown", __FILE__, __LINE__);      \
            std::abort();                                                  \
        }                                                                  \
    } while (0)

namespace cuutil {

void CudaContext::destroy() {
    if (context) {
        cuCtxDestroy(context);
        context = nullptr;
    }
}

CudaContext createContext(int deviceOrdinal) {
    CudaContext ctx{};
    CU_CHECK(cuInit(0));
    CU_CHECK(cuDeviceGet(&ctx.device, deviceOrdinal));

    char name[256];
    cuDeviceGetName(name, sizeof(name), ctx.device);
    printf("CUDA device: %s\n", name);

    CU_CHECK(cuCtxCreate(&ctx.context, 0, ctx.device));
    return ctx;
}

CUmodule loadModule(const std::string& path) {
    CUmodule mod;
    CU_CHECK(cuModuleLoad(&mod, path.c_str()));
    return mod;
}

CUfunction getFunction(CUmodule module, const std::string& name) {
    CUfunction func;
    CU_CHECK(cuModuleGetFunction(&func, module, name.c_str()));
    return func;
}

CUdeviceptr allocDevice(size_t bytes) {
    CUdeviceptr ptr;
    CU_CHECK(cuMemAlloc(&ptr, bytes));
    return ptr;
}

void freeDevice(CUdeviceptr ptr) {
    cuMemFree(ptr);
}

void copyToDevice(CUdeviceptr dst, const void* src, size_t bytes) {
    CU_CHECK(cuMemcpyHtoD(dst, src, bytes));
}

void copyToHost(void* dst, CUdeviceptr src, size_t bytes) {
    CU_CHECK(cuMemcpyDtoH(dst, src, bytes));
}

}  // namespace cuutil
