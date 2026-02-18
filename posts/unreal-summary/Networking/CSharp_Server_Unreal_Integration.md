---
title: "C# 서버 + 언리얼 엔진 연동 완전 가이드"
date: "2025-11-23"
status: "stable"
project: "UnrealEngine"
lang: "ko"
category: "unreal-summary"
track: "Networking"
tags: ["unreal", "Networking"]
---
# C# 서버 + 언리얼 엔진 연동 완전 가이드

## 📑 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [통신 프로토콜 선택](#2-통신-프로토콜-선택)
3. [C# 서버 구현 (ASP.NET Core)](#3-c-서버-구현-aspnet-core)
4. [언리얼 클라이언트 구현](#4-언리얼-클라이언트-구현)
5. [실시간 통신 (WebSocket/SignalR)](#5-실시간-통신-websocketsignalr)
6. [데이터 직렬화 (JSON/Protobuf)](#6-데이터-직렬화-jsonprotobuf)
7. [인증 및 보안](#7-인증-및-보안)
8. [실전 예제: 리듬 게임 서버](#8-실전-예제-리듬-게임-서버)

---

## 🏗️ 1. 아키텍처 개요

### 1.1 전체 구조

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         게임 아키텍처                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────┐                  ┌──────────────────────┐    │
│  │  언리얼 클라이언트     │ ←────────────→  │  C# 백엔드 서버       │    │
│  │  (Unreal Engine)     │   HTTP/WS       │  (ASP.NET Core)      │    │
│  ├──────────────────────┤                  ├──────────────────────┤    │
│  │ • 게임 로직           │                  │ • API 엔드포인트      │    │
│  │ • UI/UX              │                  │ • 실시간 통신         │    │
│  │ • 렌더링              │                  │ • 비즈니스 로직       │    │
│  │ • 사운드              │                  │ • 인증/인가           │    │
│  └──────────────────────┘                  └──────┬───────────────┘    │
│                                                   │                     │
│                                                   ↓                     │
│                              ┌────────────────────────────────┐         │
│                              │  데이터베이스                    │         │
│                              │  (SQL Server / PostgreSQL)     │         │
│                              ├────────────────────────────────┤         │
│                              │ • 유저 정보                      │         │
│                              │ • 게임 데이터                    │         │
│                              │ • 리더보드                       │         │
│                              │ • 세션 관리                      │         │
│                              └────────────────────────────────┘         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 통신 방식 비교

| 방식 | 용도 | 지연시간 | 구현 복잡도 | 추천 시나리오 |
|------|------|---------|------------|--------------|
| **REST API** | 요청/응답 | 높음 (100-500ms) | 낮음 ⭐ | 로그인, 곡 목록 조회, 점수 제출 |
| **WebSocket** | 양방향 실시간 | 낮음 (10-50ms) | 중간 ⭐⭐ | 멀티플레이어, 채팅, 실시간 순위 |
| **SignalR** | 실시간 RPC | 낮음 (10-50ms) | 낮음 ⭐ | WebSocket + 자동 재연결 |
| **gRPC** | 고성능 RPC | 매우 낮음 (5-20ms) | 높음 ⭐⭐⭐ | 고빈도 통신 (초당 100+ 요청) |
| **TCP Socket** | 커스텀 프로토콜 | 매우 낮음 (5-20ms) | 매우 높음 ⭐⭐⭐⭐ | MMORPG, FPS (완전 제어 필요) |

**리듬 게임 추천:** REST API (기본) + SignalR (실시간 기능)

---

## 🌐 2. 통신 프로토콜 선택

### 2.1 REST API (기본)

**장점:**
- ✅ 구현 간단
- ✅ 디버깅 쉬움 (Postman, Swagger)
- ✅ 캐싱 가능 (CDN)
- ✅ 상태 비저장 (Stateless)

**단점:**
- ❌ 실시간 통신 불가
- ❌ 폴링 필요 (서버 부하)

**사용 사례:**
```cpp
// 곡 목록 조회
GET /api/songs

// 점수 제출
POST /api/scores
{
    "songId": 123,
    "score": 9850,
    "accuracy": 98.5
}

// 리더보드 조회
GET /api/leaderboard?songId=123&top=100
```

### 2.2 SignalR (실시간)

**장점:**
- ✅ WebSocket 자동 fallback (Server-Sent Events, Long Polling)
- ✅ 자동 재연결
- ✅ RPC 스타일 호출
- ✅ 그룹 관리 (방, 채널)

**단점:**
- ❌ C# 전용 (클라이언트 라이브러리 필요)

**사용 사례:**
```cpp
// 실시간 순위 업데이트
Hub -> Client: "OnRankingUpdated"

// 멀티플레이어 동기화
Client -> Hub: "PlayerReady"
Hub -> All: "GameStartCountdown"
```

### 2.3 gRPC (고성능)

**장점:**
- ✅ HTTP/2 기반 (멀티플렉싱)
- ✅ Protobuf 직렬화 (빠름)
- ✅ 양방향 스트리밍

**단점:**
- ❌ 복잡한 설정
- ❌ 브라우저 직접 지원 안 됨

**사용 사례:**
```protobuf
service GameService {
    rpc SubmitScore(ScoreRequest) returns (ScoreResponse);
    rpc StreamRanking(Empty) returns (stream RankingUpdate);
}
```

---

## 🖥️ 3. C# 서버 구현 (ASP.NET Core)

### 3.1 프로젝트 생성

```bash
# .NET 6.0 이상 필요
dotnet --version

# ASP.NET Core Web API 프로젝트 생성
dotnet new webapi -n RhythmGameServer
cd RhythmGameServer

# 필요한 패키지 설치
dotnet add package Microsoft.AspNetCore.SignalR
dotnet add package Microsoft.EntityFrameworkCore.SqlServer
dotnet add package Swashbuckle.AspNetCore
dotnet add package BCrypt.Net-Next
dotnet add package System.IdentityModel.Tokens.Jwt
```

### 3.2 프로젝트 구조

```
RhythmGameServer/
├── Controllers/           # REST API 컨트롤러
│   ├── AuthController.cs
│   ├── SongsController.cs
│   ├── ScoresController.cs
│   └── LeaderboardController.cs
├── Hubs/                  # SignalR 허브
│   └── GameHub.cs
├── Models/                # 데이터 모델
│   ├── User.cs
│   ├── Song.cs
│   ├── Score.cs
│   └── DTOs/              # Data Transfer Objects
│       ├── LoginRequest.cs
│       ├── ScoreSubmitRequest.cs
│       └── LeaderboardEntry.cs
├── Services/              # 비즈니스 로직
│   ├── AuthService.cs
│   ├── ScoreService.cs
│   └── LeaderboardService.cs
├── Data/                  # 데이터베이스
│   └── GameDbContext.cs
├── Program.cs             # 진입점
└── appsettings.json       # 설정
```

### 3.3 데이터 모델

```csharp
// Models/User.cs
public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation Properties
    public ICollection<Score> Scores { get; set; } = new List<Score>();
}

// Models/Song.cs
public class Song
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Artist { get; set; } = string.Empty;
    public float BPM { get; set; }
    public int Duration { get; set; } // 초 단위
    public string DifficultyLevel { get; set; } = "Normal";
    public string AudioFileUrl { get; set; } = string.Empty;

    // Navigation Properties
    public ICollection<Score> Scores { get; set; } = new List<Score>();
}

// Models/Score.cs
public class Score
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int SongId { get; set; }
    public int Points { get; set; }
    public float Accuracy { get; set; }
    public int Combo { get; set; }
    public int PerfectHits { get; set; }
    public int GoodHits { get; set; }
    public int MissHits { get; set; }
    public DateTime PlayedAt { get; set; } = DateTime.UtcNow;

    // Navigation Properties
    public User User { get; set; } = null!;
    public Song Song { get; set; } = null!;
}
```

### 3.4 DbContext

```csharp
// Data/GameDbContext.cs
using Microsoft.EntityFrameworkCore;

public class GameDbContext : DbContext
{
    public GameDbContext(DbContextOptions<GameDbContext> options)
        : base(options)
    {
    }

    public DbSet<User> Users { get; set; }
    public DbSet<Song> Songs { get; set; }
    public DbSet<Score> Scores { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // User 설정
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Username).IsUnique();
            entity.HasIndex(e => e.Email).IsUnique();
        });

        // Song 설정
        modelBuilder.Entity<Song>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Title);
        });

        // Score 설정
        modelBuilder.Entity<Score>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.SongId, e.Points });

            entity.HasOne(e => e.User)
                .WithMany(u => u.Scores)
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Song)
                .WithMany(s => s.Scores)
                .HasForeignKey(e => e.SongId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
```

### 3.5 REST API 컨트롤러

```csharp
// Controllers/AuthController.cs
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly GameDbContext _context;
    private readonly IConfiguration _configuration;

    public AuthController(GameDbContext context, IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        // 중복 확인
        if (await _context.Users.AnyAsync(u => u.Username == request.Username))
        {
            return BadRequest(new { error = "Username already exists" });
        }

        // 비밀번호 해싱
        string passwordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);

        // 유저 생성
        var user = new User
        {
            Username = request.Username,
            Email = request.Email,
            PasswordHash = passwordHash
        };

        _context.Users.Add(user);
        await _context.SaveChangesAsync();

        return Ok(new { message = "User registered successfully", userId = user.Id });
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        // 유저 찾기
        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.Username == request.Username);

        if (user == null)
        {
            return Unauthorized(new { error = "Invalid credentials" });
        }

        // 비밀번호 검증
        if (!BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            return Unauthorized(new { error = "Invalid credentials" });
        }

        // JWT 토큰 생성
        string token = GenerateJwtToken(user);

        return Ok(new
        {
            token = token,
            userId = user.Id,
            username = user.Username
        });
    }

    private string GenerateJwtToken(User user)
    {
        var securityKey = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_configuration["Jwt:Key"]));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username)
        };

        var token = new JwtSecurityToken(
            issuer: _configuration["Jwt:Issuer"],
            audience: _configuration["Jwt:Audience"],
            claims: claims,
            expires: DateTime.Now.AddDays(7),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

// Controllers/ScoresController.cs
[ApiController]
[Route("api/[controller]")]
[Authorize] // JWT 인증 필요
public class ScoresController : ControllerBase
{
    private readonly GameDbContext _context;

    public ScoresController(GameDbContext context)
    {
        _context = context;
    }

    [HttpPost]
    public async Task<IActionResult> SubmitScore([FromBody] ScoreSubmitRequest request)
    {
        // 현재 유저 ID 가져오기 (JWT에서)
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier);
        if (userIdClaim == null)
        {
            return Unauthorized();
        }

        int userId = int.Parse(userIdClaim.Value);

        // 곡 존재 확인
        var song = await _context.Songs.FindAsync(request.SongId);
        if (song == null)
        {
            return NotFound(new { error = "Song not found" });
        }

        // 점수 저장
        var score = new Score
        {
            UserId = userId,
            SongId = request.SongId,
            Points = request.Points,
            Accuracy = request.Accuracy,
            Combo = request.Combo,
            PerfectHits = request.PerfectHits,
            GoodHits = request.GoodHits,
            MissHits = request.MissHits
        };

        _context.Scores.Add(score);
        await _context.SaveChangesAsync();

        // 순위 계산
        int rank = await _context.Scores
            .Where(s => s.SongId == request.SongId && s.Points > score.Points)
            .CountAsync() + 1;

        return Ok(new
        {
            scoreId = score.Id,
            rank = rank,
            message = "Score submitted successfully"
        });
    }

    [HttpGet("my-scores")]
    public async Task<IActionResult> GetMyScores([FromQuery] int? songId = null)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier);
        if (userIdClaim == null)
        {
            return Unauthorized();
        }

        int userId = int.Parse(userIdClaim.Value);

        var query = _context.Scores
            .Include(s => s.Song)
            .Where(s => s.UserId == userId);

        if (songId.HasValue)
        {
            query = query.Where(s => s.SongId == songId.Value);
        }

        var scores = await query
            .OrderByDescending(s => s.Points)
            .Select(s => new
            {
                s.Id,
                s.Points,
                s.Accuracy,
                s.Combo,
                s.PlayedAt,
                Song = new
                {
                    s.Song.Id,
                    s.Song.Title,
                    s.Song.Artist
                }
            })
            .ToListAsync();

        return Ok(scores);
    }
}

// Controllers/LeaderboardController.cs
[ApiController]
[Route("api/[controller]")]
public class LeaderboardController : ControllerBase
{
    private readonly GameDbContext _context;

    public LeaderboardController(GameDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<IActionResult> GetLeaderboard(
        [FromQuery] int songId,
        [FromQuery] int top = 100)
    {
        var leaderboard = await _context.Scores
            .Include(s => s.User)
            .Where(s => s.SongId == songId)
            .GroupBy(s => s.UserId)
            .Select(g => g.OrderByDescending(s => s.Points).First())
            .OrderByDescending(s => s.Points)
            .Take(top)
            .Select((s, index) => new
            {
                Rank = index + 1,
                Username = s.User.Username,
                Points = s.Points,
                Accuracy = s.Accuracy,
                Combo = s.Combo,
                PlayedAt = s.PlayedAt
            })
            .ToListAsync();

        return Ok(leaderboard);
    }
}
```

### 3.6 SignalR Hub (실시간 통신)

```csharp
// Hubs/GameHub.cs
using Microsoft.AspNetCore.SignalR;

public class GameHub : Hub
{
    private readonly GameDbContext _context;
    private static readonly Dictionary<string, string> ConnectedUsers = new();

    public GameHub(GameDbContext context)
    {
        _context = context;
    }

    // 연결 시
    public override async Task OnConnectedAsync()
    {
        var userId = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (userId != null)
        {
            ConnectedUsers[Context.ConnectionId] = userId;
            await Clients.Others.SendAsync("UserConnected", userId);
        }

        await base.OnConnectedAsync();
    }

    // 연결 해제 시
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (ConnectedUsers.TryGetValue(Context.ConnectionId, out var userId))
        {
            ConnectedUsers.Remove(Context.ConnectionId);
            await Clients.Others.SendAsync("UserDisconnected", userId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    // 멀티플레이어 방 입장
    public async Task JoinRoom(string roomId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("PlayerJoined", Context.ConnectionId);
    }

    // 멀티플레이어 방 퇴장
    public async Task LeaveRoom(string roomId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("PlayerLeft", Context.ConnectionId);
    }

    // 게임 시작 카운트다운
    public async Task StartGameCountdown(string roomId)
    {
        for (int i = 3; i > 0; i--)
        {
            await Clients.Group(roomId).SendAsync("CountdownTick", i);
            await Task.Delay(1000);
        }

        await Clients.Group(roomId).SendAsync("GameStarted");
    }

    // 실시간 점수 브로드캐스트
    public async Task BroadcastScore(string roomId, int currentScore)
    {
        var userId = ConnectedUsers[Context.ConnectionId];
        await Clients.Group(roomId).SendAsync("PlayerScoreUpdated", userId, currentScore);
    }

    // 게임 종료 결과
    public async Task GameFinished(string roomId, int finalScore)
    {
        var userId = ConnectedUsers[Context.ConnectionId];
        await Clients.Group(roomId).SendAsync("PlayerFinished", userId, finalScore);
    }
}
```

### 3.7 Program.cs (진입점)

```csharp
// Program.cs
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// 서비스 등록
builder.Services.AddControllers();
builder.Services.AddSignalR();

// 데이터베이스
builder.Services.AddDbContext<GameDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// JWT 인증
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]))
        };

        // SignalR에서 JWT 토큰 읽기
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;

                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            }
        };
    });

// CORS (언리얼에서 접근 허용)
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowUnreal", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

// Swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// 미들웨어 파이프라인
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowUnreal");
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<GameHub>("/hubs/game");

app.Run();
```

### 3.8 appsettings.json

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=localhost;Database=RhythmGameDB;Trusted_Connection=True;TrustServerCertificate=True"
  },
  "Jwt": {
    "Key": "YourSuperSecretKeyThatIsAtLeast32CharactersLong!",
    "Issuer": "RhythmGameServer",
    "Audience": "RhythmGameClient"
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
```

### 3.9 서버 실행

```bash
# 데이터베이스 마이그레이션 생성
dotnet ef migrations add InitialCreate
dotnet ef database update

# 서버 실행
dotnet run

# Output:
# Now listening on: http://localhost:5000
# Now listening on: https://localhost:5001
```

---

## 🎮 4. 언리얼 클라이언트 구현

### 4.1 HTTP 요청 (REST API)

**플러그인 활성화:**
```
Edit → Plugins → HTTP → Enable
```

**C++ 모듈 의존성:**
```cpp
// YourProject.Build.cs
PublicDependencyModuleNames.AddRange(new string[]
{
    "Core",
    "CoreUObject",
    "Engine",
    "Http",          // HTTP 요청
    "Json",          // JSON 파싱
    "JsonUtilities"  // JSON 유틸리티
});
```

#### HTTP Request Manager

```cpp
// HttpRequestManager.h
#pragma once

#include "CoreMinimal.h"
#include "Http.h"
#include "Json.h"
#include "JsonUtilities.h"

DECLARE_DELEGATE_TwoParams(FOnHttpResponse, bool /*bSuccess*/, const FString& /*Response*/);

class RHYTHMGAME_API FHttpRequestManager
{
public:
    static FHttpRequestManager& Get()
    {
        static FHttpRequestManager Instance;
        return Instance;
    }

    // REST API 기본 URL
    FString BaseURL = TEXT("http://localhost:5000/api");

    // GET 요청
    void SendGetRequest(const FString& Endpoint, const FOnHttpResponse& Callback);

    // POST 요청
    void SendPostRequest(const FString& Endpoint, const FString& JsonPayload,
        const FOnHttpResponse& Callback);

    // JWT 토큰 설정
    void SetAuthToken(const FString& Token);

private:
    FString AuthToken;

    void OnRequestComplete(FHttpRequestPtr Request, FHttpResponsePtr Response,
        bool bWasSuccessful, FOnHttpResponse Callback);
};

// HttpRequestManager.cpp
#include "HttpRequestManager.h"

void FHttpRequestManager::SendGetRequest(const FString& Endpoint, const FOnHttpResponse& Callback)
{
    TSharedRef<IHttpRequest> Request = FHttpModule::Get().CreateRequest();
    Request->SetVerb(TEXT("GET"));
    Request->SetURL(BaseURL + Endpoint);
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));

    if (!AuthToken.IsEmpty())
    {
        Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Bearer %s"), *AuthToken));
    }

    Request->OnProcessRequestComplete().BindRaw(this, &FHttpRequestManager::OnRequestComplete, Callback);
    Request->ProcessRequest();
}

void FHttpRequestManager::SendPostRequest(const FString& Endpoint, const FString& JsonPayload,
    const FOnHttpResponse& Callback)
{
    TSharedRef<IHttpRequest> Request = FHttpModule::Get().CreateRequest();
    Request->SetVerb(TEXT("POST"));
    Request->SetURL(BaseURL + Endpoint);
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Request->SetContentAsString(JsonPayload);

    if (!AuthToken.IsEmpty())
    {
        Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Bearer %s"), *AuthToken));
    }

    Request->OnProcessRequestComplete().BindRaw(this, &FHttpRequestManager::OnRequestComplete, Callback);
    Request->ProcessRequest();
}

void FHttpRequestManager::SetAuthToken(const FString& Token)
{
    AuthToken = Token;
}

void FHttpRequestManager::OnRequestComplete(FHttpRequestPtr Request, FHttpResponsePtr Response,
    bool bWasSuccessful, FOnHttpResponse Callback)
{
    if (bWasSuccessful && Response.IsValid())
    {
        FString ResponseStr = Response->GetContentAsString();
        Callback.ExecuteIfBound(true, ResponseStr);
    }
    else
    {
        FString Error = Request.IsValid() ? Request->GetURL() : TEXT("Unknown");
        UE_LOG(LogTemp, Error, TEXT("HTTP Request Failed: %s"), *Error);
        Callback.ExecuteIfBound(false, TEXT(""));
    }
}
```

#### 사용 예시: 로그인

```cpp
// GameMode or PlayerController
void AMyPlayerController::LoginUser(const FString& Username, const FString& Password)
{
    // JSON 페이로드 생성
    TSharedPtr<FJsonObject> JsonObject = MakeShared<FJsonObject>();
    JsonObject->SetStringField(TEXT("username"), Username);
    JsonObject->SetStringField(TEXT("password"), Password);

    FString JsonPayload;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonPayload);
    FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);

    // POST 요청
    FHttpRequestManager::Get().SendPostRequest(TEXT("/auth/login"), JsonPayload,
        FOnHttpResponse::CreateUObject(this, &AMyPlayerController::OnLoginResponse));
}

void AMyPlayerController::OnLoginResponse(bool bSuccess, const FString& Response)
{
    if (bSuccess)
    {
        // JSON 파싱
        TSharedPtr<FJsonObject> JsonObject;
        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response);

        if (FJsonSerializer::Deserialize(Reader, JsonObject))
        {
            FString Token = JsonObject->GetStringField(TEXT("token"));
            int32 UserId = JsonObject->GetIntegerField(TEXT("userId"));
            FString Username = JsonObject->GetStringField(TEXT("username"));

            // 토큰 저장
            FHttpRequestManager::Get().SetAuthToken(Token);

            // 로컬 저장 (다음 실행 시 자동 로그인)
            if (UGameInstance* GI = GetGameInstance())
            {
                UGameplayStatics::SaveGameToSlot(SaveGame, TEXT("UserSession"), 0);
            }

            UE_LOG(LogTemp, Log, TEXT("Login Success! UserId: %d, Username: %s"), UserId, *Username);

            // 메인 메뉴로 이동
            OnLoginSuccess.Broadcast();
        }
    }
    else
    {
        UE_LOG(LogTemp, Error, TEXT("Login Failed!"));
        OnLoginFailed.Broadcast();
    }
}
```

#### 사용 예시: 점수 제출

```cpp
void AMyPlayerController::SubmitScore(int32 SongId, int32 Points, float Accuracy,
    int32 Combo, int32 PerfectHits, int32 GoodHits, int32 MissHits)
{
    // JSON 페이로드 생성
    TSharedPtr<FJsonObject> JsonObject = MakeShared<FJsonObject>();
    JsonObject->SetNumberField(TEXT("songId"), SongId);
    JsonObject->SetNumberField(TEXT("points"), Points);
    JsonObject->SetNumberField(TEXT("accuracy"), Accuracy);
    JsonObject->SetNumberField(TEXT("combo"), Combo);
    JsonObject->SetNumberField(TEXT("perfectHits"), PerfectHits);
    JsonObject->SetNumberField(TEXT("goodHits"), GoodHits);
    JsonObject->SetNumberField(TEXT("missHits"), MissHits);

    FString JsonPayload;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonPayload);
    FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);

    // POST 요청
    FHttpRequestManager::Get().SendPostRequest(TEXT("/scores"), JsonPayload,
        FOnHttpResponse::CreateUObject(this, &AMyPlayerController::OnScoreSubmitResponse));
}

void AMyPlayerController::OnScoreSubmitResponse(bool bSuccess, const FString& Response)
{
    if (bSuccess)
    {
        TSharedPtr<FJsonObject> JsonObject;
        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response);

        if (FJsonSerializer::Deserialize(Reader, JsonObject))
        {
            int32 Rank = JsonObject->GetIntegerField(TEXT("rank"));
            UE_LOG(LogTemp, Log, TEXT("Score Submitted! Rank: %d"), Rank);

            // UI에 순위 표시
            OnScoreSubmitted.Broadcast(Rank);
        }
    }
}
```

#### 사용 예시: 리더보드 조회

```cpp
void AMyPlayerController::FetchLeaderboard(int32 SongId, int32 Top = 100)
{
    FString Endpoint = FString::Printf(TEXT("/leaderboard?songId=%d&top=%d"), SongId, Top);

    FHttpRequestManager::Get().SendGetRequest(Endpoint,
        FOnHttpResponse::CreateUObject(this, &AMyPlayerController::OnLeaderboardResponse));
}

void AMyPlayerController::OnLeaderboardResponse(bool bSuccess, const FString& Response)
{
    if (bSuccess)
    {
        TArray<TSharedPtr<FJsonValue>> JsonArray;
        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response);

        if (FJsonSerializer::Deserialize(Reader, JsonArray))
        {
            TArray<FLeaderboardEntry> Leaderboard;

            for (const TSharedPtr<FJsonValue>& Value : JsonArray)
            {
                TSharedPtr<FJsonObject> EntryObj = Value->AsObject();

                FLeaderboardEntry Entry;
                Entry.Rank = EntryObj->GetIntegerField(TEXT("rank"));
                Entry.Username = EntryObj->GetStringField(TEXT("username"));
                Entry.Points = EntryObj->GetIntegerField(TEXT("points"));
                Entry.Accuracy = EntryObj->GetNumberField(TEXT("accuracy"));
                Entry.Combo = EntryObj->GetIntegerField(TEXT("combo"));

                Leaderboard.Add(Entry);
            }

            // UI 업데이트
            OnLeaderboardFetched.Broadcast(Leaderboard);
        }
    }
}

// LeaderboardEntry.h
USTRUCT(BlueprintType)
struct FLeaderboardEntry
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly)
    int32 Rank = 0;

    UPROPERTY(BlueprintReadOnly)
    FString Username;

    UPROPERTY(BlueprintReadOnly)
    int32 Points = 0;

    UPROPERTY(BlueprintReadOnly)
    float Accuracy = 0.0f;

    UPROPERTY(BlueprintReadOnly)
    int32 Combo = 0;
};
```

---

## ⚡ 5. 실시간 통신 (WebSocket/SignalR)

### 5.1 SignalR 클라이언트 (C++)

**Third-Party 라이브러리 필요:**
- [signalr-client-cpp](https://github.com/aspnet/SignalR-Client-Cpp)

**또는 WebSocket 직접 구현:**

```cpp
// WebSocket 플러그인 활성화
// Edit → Plugins → WebSockets → Enable

// YourProject.Build.cs
PublicDependencyModuleNames.AddRange(new string[]
{
    "WebSockets"
});
```

#### WebSocket Manager

```cpp
// WebSocketManager.h
#pragma once

#include "CoreMinimal.h"
#include "IWebSocket.h"

DECLARE_MULTICAST_DELEGATE_OneParam(FOnWebSocketMessage, const FString& /*Message*/);

class RHYTHMGAME_API FWebSocketManager
{
public:
    static FWebSocketManager& Get()
    {
        static FWebSocketManager Instance;
        return Instance;
    }

    // 연결
    void Connect(const FString& URL);

    // 메시지 전송
    void SendMessage(const FString& Message);

    // 연결 해제
    void Disconnect();

    // 이벤트
    FOnWebSocketMessage OnMessageReceived;

private:
    TSharedPtr<IWebSocket> WebSocket;

    void OnConnected();
    void OnConnectionError(const FString& Error);
    void OnClosed(int32 StatusCode, const FString& Reason, bool bWasClean);
    void OnMessage(const FString& Message);
};

// WebSocketManager.cpp
#include "WebSocketManager.h"
#include "WebSocketsModule.h"

void FWebSocketManager::Connect(const FString& URL)
{
    if (WebSocket.IsValid() && WebSocket->IsConnected())
    {
        UE_LOG(LogTemp, Warning, TEXT("Already connected!"));
        return;
    }

    WebSocket = FWebSocketsModule::Get().CreateWebSocket(URL);

    WebSocket->OnConnected().AddRaw(this, &FWebSocketManager::OnConnected);
    WebSocket->OnConnectionError().AddRaw(this, &FWebSocketManager::OnConnectionError);
    WebSocket->OnClosed().AddRaw(this, &FWebSocketManager::OnClosed);
    WebSocket->OnMessage().AddRaw(this, &FWebSocketManager::OnMessage);

    WebSocket->Connect();
}

void FWebSocketManager::SendMessage(const FString& Message)
{
    if (WebSocket.IsValid() && WebSocket->IsConnected())
    {
        WebSocket->Send(Message);
    }
    else
    {
        UE_LOG(LogTemp, Error, TEXT("WebSocket not connected!"));
    }
}

void FWebSocketManager::Disconnect()
{
    if (WebSocket.IsValid())
    {
        WebSocket->Close();
    }
}

void FWebSocketManager::OnConnected()
{
    UE_LOG(LogTemp, Log, TEXT("WebSocket Connected!"));
}

void FWebSocketManager::OnConnectionError(const FString& Error)
{
    UE_LOG(LogTemp, Error, TEXT("WebSocket Error: %s"), *Error);
}

void FWebSocketManager::OnClosed(int32 StatusCode, const FString& Reason, bool bWasClean)
{
    UE_LOG(LogTemp, Log, TEXT("WebSocket Closed. Code: %d, Reason: %s"), StatusCode, *Reason);
}

void FWebSocketManager::OnMessage(const FString& Message)
{
    UE_LOG(LogTemp, Log, TEXT("WebSocket Message: %s"), *Message);
    OnMessageReceived.Broadcast(Message);
}
```

#### SignalR 프로토콜 구현 (간소화)

```cpp
// SignalR Hub Connection
void AMyPlayerController::ConnectToGameHub()
{
    FString Token = FHttpRequestManager::Get().GetAuthToken();
    FString URL = FString::Printf(TEXT("ws://localhost:5000/hubs/game?access_token=%s"), *Token);

    FWebSocketManager::Get().Connect(URL);

    // 메시지 핸들러 등록
    FWebSocketManager::Get().OnMessageReceived.AddUObject(this, &AMyPlayerController::OnHubMessage);
}

void AMyPlayerController::OnHubMessage(const FString& Message)
{
    // SignalR JSON 프로토콜 파싱
    TSharedPtr<FJsonObject> JsonObject;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);

    if (FJsonSerializer::Deserialize(Reader, JsonObject))
    {
        FString Method = JsonObject->GetStringField(TEXT("target"));
        const TArray<TSharedPtr<FJsonValue>>* Args;

        if (JsonObject->TryGetArrayField(TEXT("arguments"), Args))
        {
            // 메서드별 처리
            if (Method == TEXT("CountdownTick"))
            {
                int32 Count = (*Args)[0]->AsNumber();
                OnCountdownTick.Broadcast(Count);
            }
            else if (Method == TEXT("GameStarted"))
            {
                OnGameStarted.Broadcast();
            }
            else if (Method == TEXT("PlayerScoreUpdated"))
            {
                FString UserId = (*Args)[0]->AsString();
                int32 Score = (*Args)[1]->AsNumber();
                OnPlayerScoreUpdated.Broadcast(UserId, Score);
            }
        }
    }
}

// SignalR 메서드 호출
void AMyPlayerController::InvokeHubMethod(const FString& MethodName, const TArray<FString>& Args)
{
    // SignalR JSON 프로토콜 메시지 생성
    TSharedPtr<FJsonObject> JsonObject = MakeShared<FJsonObject>();
    JsonObject->SetStringField(TEXT("type"), TEXT("1")); // Invocation
    JsonObject->SetStringField(TEXT("target"), MethodName);

    TArray<TSharedPtr<FJsonValue>> ArgsArray;
    for (const FString& Arg : Args)
    {
        ArgsArray.Add(MakeShared<FJsonValueString>(Arg));
    }
    JsonObject->SetArrayField(TEXT("arguments"), ArgsArray);

    FString JsonString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonString);
    FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);

    JsonString += TEXT("\x1E"); // SignalR 구분자

    FWebSocketManager::Get().SendMessage(JsonString);
}

// 방 입장
void AMyPlayerController::JoinMultiplayerRoom(const FString& RoomId)
{
    TArray<FString> Args;
    Args.Add(RoomId);
    InvokeHubMethod(TEXT("JoinRoom"), Args);
}

// 점수 브로드캐스트
void AMyPlayerController::BroadcastScore(const FString& RoomId, int32 CurrentScore)
{
    TArray<FString> Args;
    Args.Add(RoomId);
    Args.Add(FString::FromInt(CurrentScore));
    InvokeHubMethod(TEXT("BroadcastScore"), Args);
}
```

---

## 📦 6. 데이터 직렬화 (JSON/Protobuf)

### 6.1 JSON (기본)

**장점:**
- ✅ 가독성 좋음 (디버깅 쉬움)
- ✅ 언리얼 기본 지원
- ✅ C# 기본 지원

**단점:**
- ❌ 크기 큼 (텍스트 기반)
- ❌ 파싱 느림

**사용 예시는 위 섹션 참조**

### 6.2 Protobuf (고성능)

**성능 비교:**
```
JSON vs Protobuf

데이터 크기:
  JSON: 1000 bytes
  Protobuf: 200 bytes (5배 작음)

직렬화 속도:
  JSON: 1.0ms
  Protobuf: 0.1ms (10배 빠름)
```

**Protobuf 설정:**

```bash
# C# 서버
dotnet add package Google.Protobuf
dotnet add package Grpc.Tools
```

```proto
// Protos/game.proto
syntax = "proto3";

package rhythmgame;

message ScoreSubmitRequest {
    int32 song_id = 1;
    int32 points = 2;
    float accuracy = 3;
    int32 combo = 4;
    int32 perfect_hits = 5;
    int32 good_hits = 6;
    int32 miss_hits = 7;
}

message ScoreSubmitResponse {
    int32 score_id = 1;
    int32 rank = 2;
    string message = 3;
}
```

**언리얼에서 Protobuf 사용:**

플러그인: [UnrealProtobuf](https://github.com/benui-dev/UnrealProtobuf)

---

## 🔐 7. 인증 및 보안

### 7.1 JWT 인증 플로우

```
1. 클라이언트 → 서버: POST /api/auth/login
   { "username": "player1", "password": "pass123" }

2. 서버 → 클라이언트: 200 OK
   { "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", "userId": 1 }

3. 클라이언트: 토큰 저장 (로컬)

4. 클라이언트 → 서버: GET /api/scores/my-scores
   Header: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

5. 서버: JWT 검증 → 유저 ID 추출 → 데이터 반환
```

### 7.2 HTTPS (필수)

**Production 환경:**
```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(443, listenOptions =>
    {
        listenOptions.UseHttps("certificate.pfx", "password");
    });
});
```

### 7.3 Rate Limiting (DoS 방지)

```csharp
// Program.cs
using AspNetCoreRateLimit;

builder.Services.AddMemoryCache();
builder.Services.Configure<IpRateLimitOptions>(options =>
{
    options.GeneralRules = new List<RateLimitRule>
    {
        new RateLimitRule
        {
            Endpoint = "*",
            Limit = 100, // 100 requests
            Period = "1m" // per minute
        }
    };
});

builder.Services.AddInMemoryRateLimiting();
builder.Services.AddSingleton<IRateLimitConfiguration, RateLimitConfiguration>();

var app = builder.Build();
app.UseIpRateLimiting();
```

---

## 🎵 8. 실전 예제: 리듬 게임 서버

### 8.1 전체 플로우

```
1. 앱 실행
   ↓
2. 자동 로그인 (저장된 토큰)
   ↓
3. 곡 목록 조회 (GET /api/songs)
   ↓
4. 곡 선택
   ↓
5. 게임 플레이 (로컬)
   ↓
6. 게임 종료
   ↓
7. 점수 제출 (POST /api/scores)
   ↓
8. 리더보드 조회 (GET /api/leaderboard?songId=123)
   ↓
9. 결과 화면 표시
```

### 8.2 멀티플레이어 플로우

```
1. 방 생성/입장 (SignalR)
   Client → Hub: JoinRoom("room123")
   ↓
2. 플레이어 대기
   Hub → All: PlayerJoined
   ↓
3. 게임 시작
   Client → Hub: StartGameCountdown
   Hub → All: CountdownTick(3, 2, 1...)
   Hub → All: GameStarted
   ↓
4. 게임 플레이 중
   Client → Hub: BroadcastScore(currentScore)
   Hub → Others: PlayerScoreUpdated
   ↓
5. 게임 종료
   Client → Hub: GameFinished(finalScore)
   Hub → All: PlayerFinished
   ↓
6. 결과 화면
```

---

## 📚 참고 자료

### C# 서버
- [ASP.NET Core Documentation](https://docs.microsoft.com/en-us/aspnet/core/)
- [SignalR Documentation](https://docs.microsoft.com/en-us/aspnet/core/signalr/)
- [Entity Framework Core](https://docs.microsoft.com/en-us/ef/core/)

### 언리얼
- [HTTP Module Documentation](https://docs.unrealengine.com/5.0/en-US/API/Runtime/HTTP/)
- [WebSockets Plugin](https://docs.unrealengine.com/5.0/en-US/API/Runtime/WebSockets/)

---

## 💡 핵심 요약

### 프로토콜 선택
- **REST API**: 로그인, 곡 목록, 점수 제출 (기본)
- **SignalR**: 멀티플레이어, 실시간 순위 (선택)

### 보안
- **JWT 토큰**: 인증
- **HTTPS**: 암호화
- **Rate Limiting**: DoS 방지

### 성능
- **JSON**: 개발 편의성
- **Protobuf**: 프로덕션 최적화

### 배포
- **Azure**: App Service + SQL Database
- **AWS**: EC2 + RDS
- **Docker**: 컨테이너화

---

**작성 완료!** 🎮

C# 서버와 언리얼 엔진 연동의 모든 것을 다뤘습니다!