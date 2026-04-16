---
name: progress-control-skill
description: Use when executing multi-step development work that needs strict progress tracking, blockers management, and evidence-based milestone updates.
user-invokable: true
args:
  - name: target
    description: 当前要推进的开发任务（可选）
    required: false
---

# 开发进度管控（执行闭环）

用于把“在做什么、做到哪里、为什么卡住、下一步是什么”管理成可追踪闭环。

## 目标

1. 让每个阶段状态可见：`todo / in_progress / blocked / done`。
2. done 必须有验证证据，不接受“理论完成”。
3. 出现阻塞时，快速切换到可执行替代路径。

## 任务卡模板

每个任务卡必须包含：

1. 任务名称  
2. 目标结果  
3. 修改范围（文件/模块）  
4. 验证方式（命令或行为检查）  
5. 当前状态  
6. 阻塞信息（若有）  

## 执行节奏

1. 启动前：建立最小计划（3-7 步）。  
2. 每次推进：只推进一个 in_progress 任务。  
3. 每步完成后：立即做对应验证。  
4. 验证通过后：更新状态为 done，并记录证据。  
5. 若失败：回到 in_progress 或转 blocked，并附失败原因。

## 阻塞处理规则

1. blocked 必须写出最小阻塞点，不写泛化描述。  
2. blocked 必须附“下一动作”，例如：  
   - 更换实现路径  
   - 缩小改动范围  
   - 降级目标  
3. 连续两次验证失败，必须重新审视方案假设。

## 输出模板

1. 当前里程碑  
2. 已完成项（含证据）  
3. 进行中项  
4. 阻塞项与处理动作  
5. 下一步（最多 3 条）

## 质量闸门

1. 没有证据，不能标记 done。  
2. 一次只能有一个 in_progress。  
3. blocked 不能超过一次更新周期不处理。  

