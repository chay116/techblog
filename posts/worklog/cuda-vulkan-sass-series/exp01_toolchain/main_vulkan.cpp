// exp01 — Vulkan toolchain: create compute pipeline, dump ISA via
// VK_KHR_pipeline_executable_properties.
#include "vk_init.h"
#include "vk_pipeline_exec.h"
#include <cstdio>
#include <fstream>
#include <vector>

static std::vector<char> readFile(const std::string& path) {
    std::ifstream f(path, std::ios::ate | std::ios::binary);
    if (!f.is_open()) {
        fprintf(stderr, "Failed to open: %s\n", path.c_str());
        std::abort();
    }
    size_t size = f.tellg();
    std::vector<char> buf(size);
    f.seekg(0);
    f.read(buf.data(), size);
    return buf;
}

int main() {
    printf("=== exp01: Vulkan Toolchain Anatomy ===\n\n");

    auto ctx = vkutil::createComputeContext(/*enablePipelineExecProps=*/true);

    // Load SPIR-V
    std::string spvPath = std::string(SPV_DIR) + "/noop.spv";
    auto spvCode = readFile(spvPath);
    printf("Loaded SPIR-V: %s (%zu bytes)\n", spvPath.c_str(),
           spvCode.size());

    // Create shader module
    VkShaderModuleCreateInfo smCI{
        VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    smCI.codeSize = spvCode.size();
    smCI.pCode = reinterpret_cast<const uint32_t*>(spvCode.data());

    VkShaderModule shaderModule;
    vkCreateShaderModule(ctx.device, &smCI, nullptr, &shaderModule);

    // Pipeline layout (empty)
    VkPipelineLayoutCreateInfo layoutCI{
        VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    VkPipelineLayout layout;
    vkCreatePipelineLayout(ctx.device, &layoutCI, nullptr, &layout);

    // Compute pipeline with CAPTURE_INTERNAL_REPRESENTATIONS flag
    VkComputePipelineCreateInfo pipeCI{
        VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    pipeCI.flags =
        VK_PIPELINE_CREATE_CAPTURE_INTERNAL_REPRESENTATIONS_BIT_KHR;
    pipeCI.stage.sType =
        VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    pipeCI.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    pipeCI.stage.module = shaderModule;
    pipeCI.stage.pName = "main";
    pipeCI.layout = layout;

    VkPipeline pipeline;
    vkCreateComputePipelines(ctx.device, VK_NULL_HANDLE, 1, &pipeCI,
                             nullptr, &pipeline);
    printf("Compute pipeline created.\n\n");

    // Dump ISA
    vkutil::PipelineExecDumper dumper;
    if (dumper.init(ctx.device)) {
        printf("Pipeline executable properties:\n");
        std::string isa = dumper.dumpISA(ctx.device, pipeline);
        if (!isa.empty()) {
            printf("\n--- ISA Output ---\n%s\n", isa.c_str());

            // Write to file
            std::ofstream out("noop_vulkan.sass");
            out << isa;
            printf("ISA written to noop_vulkan.sass\n");
        } else {
            printf("No ISA text found (driver may not support text IR).\n");
        }
    } else {
        printf("VK_KHR_pipeline_executable_properties not available.\n");
    }

    // Cleanup
    vkDestroyPipeline(ctx.device, pipeline, nullptr);
    vkDestroyPipelineLayout(ctx.device, layout, nullptr);
    vkDestroyShaderModule(ctx.device, shaderModule, nullptr);
    ctx.destroy();

    return 0;
}
