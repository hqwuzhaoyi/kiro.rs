// 凭据状态响应
export interface CredentialsStatusResponse {
  total: number
  available: number
  currentId: number
  credentials: CredentialStatusItem[]
}

// 单个凭据状态
export interface CredentialStatusItem {
  id: number
  priority: number
  disabled: boolean
  failureCount: number
  isCurrent: boolean
  expiresAt: string | null
  authMethod: string | null
  hasProfileArn: boolean
}

// 余额响应
export interface BalanceResponse {
  id: number
  subscriptionTitle: string | null
  currentUsage: number
  usageLimit: number
  remaining: number
  usagePercentage: number
  nextResetAt: number | null
}

// 成功响应
export interface SuccessResponse {
  success: boolean
  message: string
}

// 错误响应
export interface AdminErrorResponse {
  error: {
    type: string
    message: string
  }
}

// 请求类型
export interface SetDisabledRequest {
  disabled: boolean
}

export interface SetPriorityRequest {
  priority: number
}

// 添加凭据请求
export interface AddCredentialRequest {
  refreshToken: string
  authMethod?: 'social' | 'idc'
  clientId?: string
  clientSecret?: string
  priority?: number
  region?: string
}

// 添加凭据响应
export interface AddCredentialResponse {
  success: boolean
  message: string
  credentialId: number
}

// 单个凭据刷新响应
export interface RefreshTokenResponse {
  success: boolean
  message: string
  expiresAt: string | null
}

// 批量刷新中单个凭据的结果
export interface RefreshResult {
  id: number
  success: boolean
  expiresAt: string | null
  error: string | null
}

// 批量刷新汇总
export interface RefreshSummary {
  total: number
  succeeded: number
  failed: number
}

// 批量刷新响应
export interface RefreshAllResponse {
  success: boolean
  message: string
  results: RefreshResult[]
  summary: RefreshSummary
}
