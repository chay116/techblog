// exp05 — JIT Cache vs Pipeline Cache.
// Measures cold/warm compilation costs for both CUDA and Vulkan.
#include "cuda_context.h"
#include "vk_init.h"
#include <chrono>
#include <cstdio>
#include <fstream>
#include <vector>

static std::vector<char> readFile(const std::string& path) {
    std::ifstream f(path, std::ios::ate | std::ios::binary);
    if (!f.is_open()) { fprintf(stderr, "Cannot open %s\n", path.c_str()); std::abort(); }
    size_t sz = f.tellg();
    std::vector<char> buf(sz);
    f.seekg(0);
    f.read(buf.data(), sz);
    return buf;
}

// ---------- CUDA JIT measurement ----------

static void measureCudaJIT() {
    printf("--- CUDA PTX JIT Compilation ---\n");

    // Cold load: first cuModuleLoadDataEx from PTX triggers JIT
    // (In practice, we'd embed PTX or load from file)
    // For this experiment, we use the pre-compiled cubin and simulate
    // by loading the module multiple times.

    auto ctx = cuutil::createContext();

    // Measure module load time (cold)
    auto t0 = std::chrono::high_resolution_clock::now();
    // Note: actual PTX JIT requires a .ptx file. The CUDA driver caches
    // compiled results in ~/.nv/ComputeCache/
    printf("  Cold JIT:  TBD (requires PTX file, run with --ptx flag)\n");
    printf("  Warm JIT:  TBD (cached in ~/.nv/ComputeCache/)\n");
    printf("  CUDA JIT cache location: ~/.nv/ComputeCache/\n\n");

    ctx.destroy();
}

// ---------- Vulkan pipeline cache measurement ----------

static void measureVulkanPipelineCache() {
    printf("--- Vulkan Pipeline Cache ---\n");

    auto ctx = vkutil::createComputeContext();

    auto spvCode = readFile(std::string(SPV_DIR) + "/cached_kernel.spv");

    VkShaderModuleCreateInfo smCI{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    smCI.codeSize = spvCode.size();
    smCI.pCode = reinterpret_cast<const uint32_t*>(spvCode.data());
    VkShaderModule sm;
    vkCreateShaderModule(ctx.device, &smCI, nullptr, &sm);

    VkPushConstantRange pcRange{VK_SHADER_STAGE_COMPUTE_BIT, 0, 8};
    VkPipelineLayoutCreateInfo layoutCI{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    layoutCI.pushConstantRangeCount = 1;
    layoutCI.pPushConstantRanges = &pcRange;
    VkPipelineLayout layout;
    vkCreatePipelineLayout(ctx.device, &layoutCI, nullptr, &layout);

    VkComputePipelineCreateInfo pipeCI{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    pipeCI.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    pipeCI.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    pipeCI.stage.module = sm;
    pipeCI.stage.pName = "main";
    pipeCI.layout = layout;

    // Cold: no pipeline cache
    auto t0 = std::chrono::high_resolution_clock::now();
    VkPipeline pipeline1;
    vkCreateComputePipelines(ctx.device, VK_NULL_HANDLE, 1, &pipeCI, nullptr, &pipeline1);
    auto t1 = std::chrono::high_resolution_clock::now();
    double coldMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    printf("  Cold (no cache): %.3f ms\n", coldMs);

    // Create pipeline cache from the first compilation
    VkPipelineCacheCreateInfo cacheCI{VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO};
    VkPipelineCache cache;
    vkCreatePipelineCache(ctx.device, &cacheCI, nullptr, &cache);

    // Warm: populate cache
    VkPipeline pipeline2;
    vkCreateComputePipelines(ctx.device, cache, 1, &pipeCI, nullptr, &pipeline2);

    // Warm: use populated cache
    t0 = std::chrono::high_resolution_clock::now();
    VkPipeline pipeline3;
    vkCreateComputePipelines(ctx.device, cache, 1, &pipeCI, nullptr, &pipeline3);
    t1 = std::chrono::high_resolution_clock::now();
    double warmMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    printf("  Warm (cached):   %.3f ms\n", warmMs);
    printf("  Speedup:         %.1fx\n\n", coldMs / warmMs);

    // Save cache to disk
    size_t cacheSize = 0;
    vkGetPipelineCacheData(ctx.device, cache, &cacheSize, nullptr);
    std::vector<char> cacheData(cacheSize);
    vkGetPipelineCacheData(ctx.device, cache, &cacheSize, cacheData.data());
    {
        std::ofstream out("pipeline_cache.bin", std::ios::binary);
        out.write(cacheData.data(), cacheSize);
    }
    printf("  Pipeline cache saved: %zu bytes → pipeline_cache.bin\n", cacheSize);

    vkDestroyPipeline(ctx.device, pipeline1, nullptr);
    vkDestroyPipeline(ctx.device, pipeline2, nullptr);
    vkDestroyPipeline(ctx.device, pipeline3, nullptr);
    vkDestroyPipelineCache(ctx.device, cache, nullptr);
    vkDestroyPipelineLayout(ctx.device, layout, nullptr);
    vkDestroyShaderModule(ctx.device, sm, nullptr);
    ctx.destroy();
}

int main() {
    printf("=== exp05: JIT Cache vs Pipeline Cache ===\n\n");

    measureCudaJIT();
    measureVulkanPipelineCache();

    return 0;
}
