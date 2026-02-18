---
title: "FileSystem (파일 시스템)"
date: "2025-11-21"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Core"
tags: ["unreal", "Core"]
---
# FileSystem (파일 시스템)

## 🧭 개요

**FileSystem**은 언리얼 엔진의 **플랫폼 독립적 파일 I/O API**입니다. 텍스트/바이너리 파일 읽기/쓰기, 디렉토리 탐색, 파일 검색 등을 통합된 인터페이스로 제공하며, 각 플랫폼의 파일 시스템 차이를 추상화합니다.

**핵심 철학:**
> **FFileHelper**는 "간단한 파일 I/O" (전체 읽기/쓰기),
> **IFileManager**는 "파일 관리" (복사, 이동, 삭제, 검색),
> **IPlatformFile**은 "플랫폼 추상화" (낮은 수준 I/O)를 담당한다.

**📂 위치:**
- `Engine/Source/Runtime/Core/Public/Misc/FileHelper.h`
- `Engine/Source/Runtime/Core/Public/HAL/FileManager.h`
- `Engine/Source/Runtime/Core/Public/HAL/PlatformFileManager.h`

---

## 🧩 핵심 API

### 1. **FFileHelper - 편의 함수**

**텍스트 파일 읽기:**
```cpp
FString FileContent;
if (FFileHelper::LoadFileToString(FileContent, *FilePath))
{
    UE_LOG(LogTemp, Log, TEXT("File content: %s"), *FileContent);
}
```

**텍스트 파일 쓰기:**
```cpp
FString Content = TEXT("Hello, Unreal!");
FFileHelper::SaveStringToFile(Content, *FilePath);
```

**바이너리 파일 읽기:**
```cpp
TArray<uint8> BinaryData;
if (FFileHelper::LoadFileToArray(BinaryData, *FilePath))
{
    UE_LOG(LogTemp, Log, TEXT("Loaded %d bytes"), BinaryData.Num());
}
```

**바이너리 파일 쓰기:**
```cpp
TArray<uint8> Data = { 0x48, 0x65, 0x6C, 0x6C, 0x6F };  // "Hello"
FFileHelper::SaveArrayToFile(Data, *FilePath);
```

---

### 2. **IFileManager - 파일 관리**

**파일 존재 확인:**
```cpp
IFileManager& FileManager = IFileManager::Get();
if (FileManager.FileExists(*FilePath))
{
    UE_LOG(LogTemp, Log, TEXT("File exists"));
}
```

**파일 삭제/복사/이동:**
```cpp
FileManager.Delete(*FilePath);
FileManager.Copy(*DestPath, *SourcePath);
FileManager.Move(*DestPath, *SourcePath);
```

**디렉토리 작업:**
```cpp
FileManager.MakeDirectory(*DirectoryPath, true);  // true = 재귀 생성
FileManager.DeleteDirectory(*DirectoryPath, false, true);  // 재귀 삭제
```

**파일 검색:**
```cpp
TArray<FString> FoundFiles;
FileManager.FindFiles(FoundFiles, *SearchPath, TEXT("*.txt"));

for (const FString& File : FoundFiles)
{
    UE_LOG(LogTemp, Log, TEXT("Found: %s"), *File);
}
```

---

### 3. **FPaths - 경로 유틸리티**

**경로 조합:**
```cpp
FString FullPath = FPaths::Combine(BaseDir, FileName);
FString ProjectPath = FPaths::ProjectDir();
FString SavedPath = FPaths::ProjectSavedDir();  // Project/Saved/
FString ConfigPath = FPaths::ProjectConfigDir();  // Project/Config/
```

**경로 정규화:**
```cpp
FString NormalizedPath = FPaths::ConvertRelativePathToFull(RelativePath);
FPaths::NormalizeFilename(Path);  // \\ → /, 중복 / 제거
FPaths::CollapseRelativeDirectories(Path);  // ../ 처리
```

**경로 분리:**
```cpp
FString Directory = FPaths::GetPath(FullPath);
FString FileName = FPaths::GetCleanFilename(FullPath);
FString Extension = FPaths::GetExtension(FullPath);
FString BaseFileName = FPaths::GetBaseFilename(FullPath);  // 확장자 제외
```

---

## 💡 실전 패턴

### 패턴 1: JSON 파일 읽기/쓰기

```cpp
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

// JSON 저장
TSharedPtr<FJsonObject> JsonObject = MakeShared<FJsonObject>();
JsonObject->SetStringField("Name", "Player");
JsonObject->SetNumberField("Score", 100);

FString OutputString;
TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);

FFileHelper::SaveStringToFile(OutputString, *FilePath);

// JSON 로드
FString JsonString;
if (FFileHelper::LoadFileToString(JsonString, *FilePath))
{
    TSharedPtr<FJsonObject> JsonObject;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);

    if (FJsonSerializer::Deserialize(Reader, JsonObject))
    {
        FString Name = JsonObject->GetStringField("Name");
        int32 Score = JsonObject->GetIntegerField("Score");
    }
}
```

### 패턴 2: 세이브 파일 관리

```cpp
void SaveGame(const FString& SlotName, const TArray<uint8>& SaveData)
{
    FString SavePath = FPaths::ProjectSavedDir() / TEXT("SaveGames") / SlotName + TEXT(".sav");
    FFileHelper::SaveArrayToFile(SaveData, *SavePath);
}

bool LoadGame(const FString& SlotName, TArray<uint8>& OutSaveData)
{
    FString SavePath = FPaths::ProjectSavedDir() / TEXT("SaveGames") / SlotName + TEXT(".sav");
    return FFileHelper::LoadFileToArray(OutSaveData, *SavePath);
}
```

---

## 🔗 참조 자료

### 공식 문서
- Unreal Engine Docs: [File I/O](https://docs.unrealengine.com/en-US/API/Runtime/Core/Misc/FFileHelper/)

### 소스 코드
- `Engine/Source/Runtime/Core/Public/Misc/FileHelper.h`
- `Engine/Source/Runtime/Core/Public/HAL/FileManager.h`
- `Engine/Source/Runtime/Core/Public/Misc/Paths.h`

---

> 🔄 Created: 2025-01-XX — Initial documentation for FileSystem in UE 5.7
