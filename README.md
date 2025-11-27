# Wage Calculator MCP Server

这是一个Model Context Protocol (MCP)服务器，用于计算员工工资。

## 功能

提供`calculate_wage`工具，根据基本工资、工作时长、奖金等因素计算员工的总工资和净收入。

## 参数说明

- `base_salary`: 基本工资（必需）
- `overtime_hours`: 加班时长（可选，默认为0）
- `overtime_rate`: 加班费率（可选，默认为基本工资的1.5倍/小时）
- `bonus`: 奖金（可选，默认为0）
- `tax_rate`: 税率（可选，默认为0.2，即20%）
- `deductions`: 其他扣除项（如保险等，可选，默认为0）

## 安装和使用

1. 克隆项目
2. 安装依赖：`npm install`
3. 构建：`npm run build`
4. 配置到MCP设置中

## 输出

工具返回JSON格式的总工资和扣税后的净收入。
