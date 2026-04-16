---
name: completion-review-skill
description: Use when determining whether a development task is truly complete by mapping requirements to delivered changes, test evidence, and residual risks.
user-invokable: true
args:
  - name: target
    description: 需要评审的任务或改动（可选）
    required: false
---

# 完成度评审（防伪完成）

用于判断“是否真的完成”，避免仅凭主观判断宣布完成。

## 目标

1. 逐条对照需求与实现，确认无遗漏。  
2. 结论必须由证据支撑（代码位置、测试输出、运行结果）。  
3. 明确残余风险与未覆盖项，不夸大完成度。

## 评审输入

1. 需求原文或验收标准  
2. 实际改动（diff / 文件列表）  
3. 验证结果（typecheck / 单测 / 集成 / 手工检查）  
4. 异常与回退信息（若有）

## 评审流程

1. 需求映射  
   - 建立“需求点 -> 改动点 -> 验证点”映射。
2. 行为核对  
   - 正常路径、边界路径、失败路径是否覆盖。
3. 证据核验  
   - 检查验证命令是否真实执行、结果是否通过。
4. 风险归档  
   - 标注未覆盖风险、影响范围、建议后续动作。
5. 判定结论  
   - `通过 / 有条件通过 / 不通过`。

## 输出模板

1. 结论  
2. 依据  
3. 需求映射表  
4. 验证结果  
5. 未覆盖项与风险  
6. 必须修复项（如有）

## 判定规则

1. 缺任一关键验证证据 -> 不通过。  
2. 需求映射缺项 -> 不通过。  
3. 存在残余风险但不影响主路径 -> 有条件通过，并给出补救计划。  

