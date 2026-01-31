# 手动刷新 Token 功能设计

## 概述

为 Admin API 添加手动刷新 Token 的功能，支持单个凭据刷新和批量刷新。

### 使用场景

预防性刷新：在重要操作前确保 Token 是最新的，避免中途过期。

### 设计决策

1. **复用刷新锁** - 手动刷新与自动刷新共用 `refresh_lock`，避免竞态
2. **顺序执行批量刷新** - 对上游服务友好，避免瞬间大量请求
3. **允许刷新禁用凭据** - 单个刷新不检查禁用状态，方便故障恢复
4. **批量刷新跳过禁用凭据** - 只处理启用的凭据，符合预防性刷新场景
5. **持久化行为** - 与自动刷新保持一致，刷新后自动持久化到配置文件

---

## API 设计

### 单个凭据刷新

```
POST /api/admin/credentials/:id/refresh
```

**响应（成功）：**
```json
{
  "success": true,
  "message": "凭据 #1 Token 已刷新",
  "expiresAt": "2026-01-31T12:00:00Z"
}
```

### 批量刷新

```
POST /api/admin/credentials/refresh
```

**响应：**
```json
{
  "success": true,
  "message": "刷新完成：2 成功，1 失败",
  "results": [
    { "id": 1, "success": true, "expiresAt": "..." },
    { "id": 2, "success": true, "expiresAt": "..." },
    { "id": 3, "success": false, "error": "refreshToken 已过期" }
  ],
  "summary": { "total": 3, "succeeded": 2, "failed": 1 }
}
```

批量刷新只处理**未禁用**的凭据，已禁用的凭据会被跳过（不计入失败）。

---

## 实现设计

### MultiTokenManager 新增方法

#### 单个凭据刷新

```rust
pub async fn force_refresh_token(&self, id: u64) -> anyhow::Result<String> {
    // 1. 获取刷新锁（复用现有锁，避免与自动刷新冲突）
    let _guard = self.refresh_lock.lock().await;

    // 2. 获取凭据（不检查是否禁用，允许刷新禁用的凭据）
    let credentials = self.get_credentials_by_id(id)?;

    // 3. 调用现有 refresh_token() 函数
    let new_creds = refresh_token(&credentials, &self.config, self.proxy.as_ref()).await?;

    // 4. 更新内存中的凭据
    self.update_credentials(id, new_creds.clone());

    // 5. 持久化（复用现有 persist_credentials）
    self.persist_credentials()?;

    // 6. 返回新的过期时间
    Ok(new_creds.expires_at.unwrap_or_default())
}
```

#### 批量刷新

```rust
pub async fn force_refresh_all(&self) -> RefreshAllResult {
    let ids: Vec<u64> = self.get_enabled_credential_ids();
    let mut results = Vec::new();

    for id in ids {
        match self.force_refresh_token(id).await {
            Ok(expires_at) => {
                results.push(RefreshResult {
                    id,
                    success: true,
                    expires_at: Some(expires_at),
                    error: None,
                });
            }
            Err(e) => {
                results.push(RefreshResult {
                    id,
                    success: false,
                    expires_at: None,
                    error: Some(e.to_string()),
                });
            }
        }
    }

    let succeeded = results.iter().filter(|r| r.success).count();
    let failed = results.len() - succeeded;

    RefreshAllResult {
        results,
        summary: RefreshSummary {
            total: results.len(),
            succeeded,
            failed,
        },
    }
}
```

批量刷新采用**顺序执行**而非并行，原因：
1. 复用同一个 `refresh_lock`，避免并发刷新导致的竞态
2. 对上游服务更友好，避免瞬间大量请求

---

### 类型定义

在 `src/admin/types.rs` 新增：

```rust
/// 单个凭据刷新结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshTokenResponse {
    pub success: bool,
    pub message: String,
    pub expires_at: Option<String>,
}

/// 批量刷新中单个凭据的结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    pub id: u64,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 批量刷新汇总
#[derive(Debug, Clone, Serialize)]
pub struct RefreshSummary {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
}

/// 批量刷新响应
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshAllResponse {
    pub success: bool,
    pub message: String,
    pub results: Vec<RefreshResult>,
    pub summary: RefreshSummary,
}
```

---

### Handler 实现

在 `src/admin/handlers.rs` 新增：

```rust
/// POST /api/admin/credentials/:id/refresh
/// 强制刷新指定凭据的 Token
pub async fn refresh_credential_token(
    State(state): State<AdminState>,
    Path(id): Path<u64>,
) -> impl IntoResponse {
    match state.service.refresh_token(id).await {
        Ok(expires_at) => Json(RefreshTokenResponse {
            success: true,
            message: format!("凭据 #{} Token 已刷新", id),
            expires_at: Some(expires_at),
        }).into_response(),
        Err(e) => (e.status_code(), Json(e.into_response())).into_response(),
    }
}

/// POST /api/admin/credentials/refresh
/// 批量刷新所有启用凭据的 Token
pub async fn refresh_all_tokens(
    State(state): State<AdminState>,
) -> impl IntoResponse {
    let result = state.service.refresh_all_tokens().await;
    Json(result)
}
```

---

### 路由配置

在 `src/admin/router.rs` 新增：

```rust
.route("/credentials/refresh", post(refresh_all_tokens))
.route("/credentials/{id}/refresh", post(refresh_credential_token))
```

注意：`/credentials/refresh` 需要放在 `/credentials/{id}` 之前，避免 `refresh` 被误解析为 id。

---

### AdminService 层

在 `src/admin/service.rs` 新增：

```rust
impl AdminService {
    /// 强制刷新指定凭据的 Token
    pub async fn refresh_token(&self, id: u64) -> Result<String, AdminError> {
        self.token_manager
            .force_refresh_token(id)
            .await
            .map_err(|e| AdminError::RefreshFailed(e.to_string()))
    }

    /// 批量刷新所有启用凭据的 Token
    pub async fn refresh_all_tokens(&self) -> RefreshAllResponse {
        let result = self.token_manager.force_refresh_all().await;

        let message = format!(
            "刷新完成：{} 成功，{} 失败",
            result.summary.succeeded,
            result.summary.failed
        );

        RefreshAllResponse {
            success: result.summary.failed == 0,
            message,
            results: result.results,
            summary: result.summary,
        }
    }
}
```

---

### AdminError 新增变体

在 `src/admin/error.rs` 新增：

```rust
pub enum AdminError {
    // ... 现有变体
    RefreshFailed(String),
}
```

---

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/kiro/token_manager.rs` | 新增 `force_refresh_token()` 和 `force_refresh_all()` 方法 |
| `src/admin/types.rs` | 新增 `RefreshTokenResponse`、`RefreshResult`、`RefreshSummary`、`RefreshAllResponse` 类型 |
| `src/admin/error.rs` | 新增 `RefreshFailed` 错误变体 |
| `src/admin/service.rs` | 新增 `refresh_token()` 和 `refresh_all_tokens()` 方法 |
| `src/admin/handlers.rs` | 新增 `refresh_credential_token()` 和 `refresh_all_tokens()` handler |
| `src/admin/router.rs` | 新增两个路由 |
