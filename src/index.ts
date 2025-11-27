#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_VALUES = {
  base_salary: 10000,
  overtime_hours: 0,
  overtime_rate: 1.5,
  bonus: 0,
};

 interface WageCalculationArgs {
  base_salary?: number;
  overtime_hours?: number;
  overtime_rate?: number;
  bonus?: number;
}

//社保公积金配置（深圳2024基准）
const SOCIAL_INSURANCE_RATES = {
  pension: { personal: 0.08, company: 0.16 },
  unemployment: { personal: 0.004, company: 0.006 },
  injury: { personal: 0, company: 0.0156 },
  medical: { personal: 0.02, company: 0.07 }, //包含生育保险
  housingFund: { personal: 0.06, company: 0.06 }
};

const BASE_SOCIAL_INSURANCE = 59469; //深圳上年社平均工资

const isValidWageArgs = (args: any): args is WageCalculationArgs =>
  typeof args === 'object' &&
  args !== null &&
  (args.base_salary === undefined || (typeof args.base_salary === 'number' && args.base_salary > 0)) &&
  (args.overtime_hours === undefined || (typeof args.overtime_hours === 'number' && args.overtime_hours >= 0)) &&
  (args.overtime_rate === undefined || typeof args.overtime_rate === 'number') &&
  (args.bonus === undefined || (typeof args.bonus === 'number' && args.bonus >= 0));

//中国个税税率表2024（月度计算）
function calculateIndividualIncomeTax(monthlyIncome: number): number {
  const Y = monthlyIncome - 5000; // 免税额后的应纳税所得额
  if (Y <= 0) return 0;
  if (Y <= 5000) return Y * 0.03;
  if (Y <= 12000) return Y * 0.1 - 210;
  if (Y <= 25000) return Y * 0.15 - 1410;
  if (Y <= 35000) return Y * 0.2 - 2660;
  if (Y <= 55000) return Y * 0.25 - 4410;
  if (Y <= 80000) return Y * 0.3 - 7160;
  return Y * 0.35 - 15160;
}

function calculateSocialInsurance(base: number) {
  const results = {
    pension: { personal: base * SOCIAL_INSURANCE_RATES.pension.personal, company: base * SOCIAL_INSURANCE_RATES.pension.company },
    unemployment: { personal: base * SOCIAL_INSURANCE_RATES.unemployment.personal, company: base * SOCIAL_INSURANCE_RATES.unemployment.company },
    injury: { personal: base * SOCIAL_INSURANCE_RATES.injury.personal, company: base * SOCIAL_INSURANCE_RATES.injury.company },
    medical: { personal: base * SOCIAL_INSURANCE_RATES.medical.personal, company: base * SOCIAL_INSURANCE_RATES.medical.company },
    housingFund: { personal: base * SOCIAL_INSURANCE_RATES.housingFund.personal, company: base * SOCIAL_INSURANCE_RATES.housingFund.company }
  };

  const personalTotal = Object.values(results).reduce((sum, item) => sum + item.personal, 0);
  const companyTotal = Object.values(results).reduce((sum, item) => sum + item.company, 0);

  return {
    details: results,
    personalTotal,
    companyTotal
  };
}

class WageCalculatorServer {
  private server: Server;

  constructor() {
    this.server = new Server({
      name: 'wage-calculator-server',
      version: '0.1.0',
      capabilities: {
        tools: {},
      },
    });

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'calculate_wage',
          description: 'Calculate comprehensive Chinese employee salary including social insurance, housing fund, and progressive income tax',
          inputSchema: {
            type: 'object',
            properties: {
              base_salary: {
                type: 'number',
                description: 'Monthly basic salary (default: 10000 CNY)',
                minimum: 0,
                default: 10000,
              },
              overtime_hours: {
                type: 'number',
                description: 'Monthly overtime hours (default: 0)',
                minimum: 0,
                default: 0,
              },
              overtime_rate: {
                type: 'number',
                description: 'Overtime hourly multiplier (default: 1.5)',
                minimum: 1,
                default: 1.5,
              },
              bonus: {
                type: 'number',
                description: 'Additional monthly bonus (default: 0)',
                minimum: 0,
                default: 0,
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'calculate_wage') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      if (!isValidWageArgs(request.params.arguments)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Invalid wage calculation arguments'
        );
      }

      const args = request.params.arguments;
      const baseSalary = args.base_salary ?? DEFAULT_VALUES.base_salary;
      const overtimeHours = args.overtime_hours ?? DEFAULT_VALUES.overtime_hours;
      const overtimeRate = args.overtime_rate ?? DEFAULT_VALUES.overtime_rate;
      const bonus = args.bonus ?? DEFAULT_VALUES.bonus;

      //总月工资 = 基本工资 + 加班费 + 奖金
      const totalMonthlySalary = baseSalary + (overtimeHours * (baseSalary / 21.75) * overtimeRate) + bonus;

      //五险一金缴费基数（简化版：假设等于基本工资）
      const insuranceBase = baseSalary;

      //Personal社保公积金总缴费率16.4%
      const personalInsuranceTotal = insuranceBase * 0.164;

      //Company社保公积金总缴费率31.56%
      const companyInsuranceTotal = insuranceBase * 0.3156;

      //税前工资 = 月工资 - Personal五险一金
      const preTaxSalary = totalMonthlySalary - personalInsuranceTotal;

      //应纳税所得额 = 税前工资 - 5000免税额
      const taxableIncome = preTaxSalary - 5000;

      //计算个税
      const incomeTax = taxableIncome > 0 ? calculateIndividualIncomeTax(preTaxSalary) : 0;

      //实发工资 = 税前工资 - 个税
      const netSalary = preTaxSalary - incomeTax;

      //社保公积金明细（按照比例分配给各个险种，以符合用户理解）
      const personalInsurance = {
        pension: insuranceBase * 0.08,
        unemployment: insuranceBase * 0.004,
        injury: insuranceBase * 0,
        medical: insuranceBase * 0.02,
        housing_fund: insuranceBase * 0.06,
        total_personal: personalInsuranceTotal
      };

      const companyInsurance = {
        pension: insuranceBase * 0.16,
        unemployment: insuranceBase * 0.006,
        injury: insuranceBase * 0.0156,
        medical: insuranceBase * 0.07,
        housing_fund: insuranceBase * 0.06,
        total_company: companyInsuranceTotal
      };

      const result = {
        //工资构成
        basic: baseSalary,
        overtime_pay: overtimeHours * (baseSalary / 21.75) * overtimeRate,
        bonus: bonus,
        total_monthly_salary: totalMonthlySalary,

        //税前工资（扣除个人五险一金后的金额）
        pre_tax_salary: preTaxSalary,

        //社保公积金缴费
        insurance_base: insuranceBase,
        personal_insurance: personalInsurance,
        company_insurance: companyInsurance,

        //个税计算
        taxable_income: taxableIncome,
        individual_income_tax: incomeTax,

        //最终实发工资
        net_salary: netSalary
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Wage Calculator MCP server running on stdio');
  }
}

const server = new WageCalculatorServer();
server.run().catch(console.error);
