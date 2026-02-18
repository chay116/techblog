---
title: "UnrealBuildTool (UBT) Deep Dive"
date: "2025-01-22"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Build"
tags: ["unreal", "Build"]
---
# UnrealBuildTool (UBT) Deep Dive

## 🧭 개요

**UnrealBuildTool (UBT)** 은 C++ 프로젝트를 컴파일하는 빌드 시스템입니다.

---

## 🏗️ Module Build.cs

```csharp
// MyModule.Build.cs
public class MyModule : ModuleRules
{
    public MyModule(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine"
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Slate",
            "SlateCore"
        });
    }
}
```

---

## 🎯 Target.cs

```csharp
// MyProject.Target.cs (Game Build)
public class MyProjectTarget : TargetRules
{
    public MyProjectTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V2;
        ExtraModuleNames.Add("MyProject");
    }
}

// MyProjectEditor.Target.cs (Editor Build)
public class MyProjectEditorTarget : TargetRules
{
    public MyProjectEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V2;
        ExtraModuleNames.Add("MyProject");
    }
}
```

---

## 📝 버전 이력

- **v1.0** (2025-01-22): 초기 작성 - UnrealBuildTool