#include "vk_pipeline_exec.h"
#include <cstdio>
#include <cstring>

namespace vkutil {

bool PipelineExecDumper::init(VkDevice device) {
    fpGetProps =
        reinterpret_cast<PFN_vkGetPipelineExecutablePropertiesKHR>(
            vkGetDeviceProcAddr(
                device, "vkGetPipelineExecutablePropertiesKHR"));
    fpGetIR =
        reinterpret_cast<
            PFN_vkGetPipelineExecutableInternalRepresentationsKHR>(
            vkGetDeviceProcAddr(
                device,
                "vkGetPipelineExecutableInternalRepresentationsKHR"));

    return fpGetProps && fpGetIR;
}

std::string PipelineExecDumper::dumpISA(VkDevice device,
                                         VkPipeline pipeline) {
    if (!fpGetProps || !fpGetIR) return "";

    VkPipelineInfoKHR pipelineInfo{VK_STRUCTURE_TYPE_PIPELINE_INFO_KHR};
    pipelineInfo.pipeline = pipeline;

    uint32_t execCount = 0;
    fpGetProps(device, &pipelineInfo, &execCount, nullptr);
    std::vector<VkPipelineExecutablePropertiesKHR> execs(execCount);
    for (auto& e : execs)
        e.sType = VK_STRUCTURE_TYPE_PIPELINE_EXECUTABLE_PROPERTIES_KHR;
    fpGetProps(device, &pipelineInfo, &execCount, execs.data());

    std::string result;

    for (uint32_t i = 0; i < execCount; ++i) {
        printf("  Executable %u: %s (%s)\n", i, execs[i].name,
               execs[i].description);

        VkPipelineExecutableInfoKHR execInfo{
            VK_STRUCTURE_TYPE_PIPELINE_EXECUTABLE_INFO_KHR};
        execInfo.pipeline = pipeline;
        execInfo.executableIndex = i;

        uint32_t irCount = 0;
        fpGetIR(device, &execInfo, &irCount, nullptr);
        std::vector<VkPipelineExecutableInternalRepresentationKHR> irs(
            irCount);
        for (auto& ir : irs) {
            ir.sType =
                VK_STRUCTURE_TYPE_PIPELINE_EXECUTABLE_INTERNAL_REPRESENTATION_KHR;
            ir.pData = nullptr;
            ir.dataSize = 0;
        }
        fpGetIR(device, &execInfo, &irCount, irs.data());

        // Allocate data buffers
        for (auto& ir : irs) {
            ir.pData = new char[ir.dataSize];
        }
        fpGetIR(device, &execInfo, &irCount, irs.data());

        for (auto& ir : irs) {
            printf("    IR: %s (size=%zu, isText=%d)\n", ir.name,
                   ir.dataSize, ir.isText);
            if (ir.isText && ir.pData) {
                std::string text(static_cast<const char*>(ir.pData),
                                 ir.dataSize);
                result += "// --- " + std::string(ir.name) + " ---\n";
                result += text + "\n";
            }
            delete[] static_cast<char*>(ir.pData);
        }
    }
    return result;
}

}  // namespace vkutil
