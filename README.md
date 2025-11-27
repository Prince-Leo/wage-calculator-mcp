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
   ```bash
   git clone https://github.com/Prince-Leo/wage-calculator-mcp.git
   cd wage-calculator-mcp
   ```

2. 安装依赖：`npm install`

3. 构建：`npm run build`

4. 配置到MCP设置中：
   ```json
   {
     "mcpServers": {
       "wage-calculator-mcp": {
         "command": "node",
         "args": ["path/to/wage-calculator-mcp/build/index.js"],
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```

## 计算示例

默认参数（基本工资10000元）：

**工资构成：**
- 基本工资：10000元
- 加班费：0元
- 奖金：0元

**社保公积金（个人）：**
- 养老保险：800元 (8%)
- 失业保险：40元 (0.4%)
- 医疗保险：200元 (2%)
- 住房公积金：600元 (6%)
- 总计：1640元 (16.4%)

**税前工资：** 10000 - 1640 = 8360元

**个税计算：**
- 应纳税所得额：8360 - 5000 = 3360元
- 适用税率：3%（3360元属于5000-10000区间）
- 税额：3360 × 0.03 = 100.8元

**实发工资：** 8360 - 100.8 = 8259.2元

**企业承担费用：**
- 社保公积金总计：3156元
- 每月总成本：10000 + 3156 = 13156元

## 输出格式

工具返回详细的JSON格式结果，包含工资构成、社保明细、税费计算和最终实发工资。
