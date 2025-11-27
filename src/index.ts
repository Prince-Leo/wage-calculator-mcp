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
  const thresholds = [0, 5000, 10000, 20000, 40000, 60000, 100000];
  const rates = [0, 0.03, 0.1, 0.15, 0.2, 0.25, 0.3];
  const quickDeductions = [0, 0, 210, 1410, 2660, 4410, 8330];

  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (monthlyIncome > thresholds[i]) {
      return monthlyIncome * rates[i] - quickDeductions[i];
    }
  }
  return 0;
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

      //确保社保公积金基数不超过上年平均工资的300%，不低于60%
      const insuranceBase = Math.min(Math.max(baseSalary, BASE_SOCIAL_INSURANCE * 0.6), BASE_SOCIAL_INSURANCE * 3);

      //计算社保公积金
      const socialInsurance = calculateSocialInsurance(insuranceBase);

      //计算月度应纳税所得额（基本工资 + 加班费 - 社保个人部分 - 公积金个人部分 - 5000免税额）
      const monthlyTaxableIncome = baseSalary + (overtimeHours * (baseSalary / 21.75) * overtimeRate) - socialInsurance.personalTotal - 5000;

      //计算个税
      const incomeTax = monthlyTaxableIncome > 0 ? calculateIndividualIncomeTax(monthlyTaxableIncome) : 0;

      //计算实发工资
      const netSalary = baseSalary + (overtimeHours * (baseSalary / 21.75) * overtimeRate) + bonus - socialInsurance.personalTotal - incomeTax;

      const result = {
        //工资构成
        basic: baseSalary,
        overtime_pay: overtimeHours * (baseSalary / 21.75) * overtimeRate,
        bonus: bonus,

        //社保公积金明细（个人）
        social_insurance_personal: {
          pension: socialInsurance.details.pension.personal,
          unemployment: socialInsurance.details.unemployment.personal,
          medical: socialInsurance.details.medical.personal,
          housing_fund: socialInsurance.details.housingFund.personal,
          total_personal: socialInsurance.personalTotal
        },

        //企业承担的社保公积金
        company_social_insurance_total: socialInsurance.companyTotal,

        //税费
        individual_income_tax: incomeTax,

        //最终实发
        net_salary: netSalary,

        //调试信息
        taxable_income: monthlyTaxableIncome,
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
