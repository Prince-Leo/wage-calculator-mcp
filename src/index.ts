#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

interface WageCalculationArgs {
  base_salary: number;
  overtime_hours?: number;
  overtime_rate?: number;
  bonus?: number;
  tax_rate?: number;
  deductions?: number;
}

const isValidWageArgs = (args: any): args is WageCalculationArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.base_salary === 'number' &&
  args.base_salary > 0 &&
  (args.overtime_hours === undefined || (typeof args.overtime_hours === 'number' && args.overtime_hours >= 0)) &&
  (args.overtime_rate === undefined || typeof args.overtime_rate === 'number') &&
  (args.bonus === undefined || (typeof args.bonus === 'number' && args.bonus >= 0)) &&
  (args.tax_rate === undefined || (typeof args.tax_rate === 'number' && args.tax_rate >= 0 && args.tax_rate <= 1)) &&
  (args.deductions === undefined || (typeof args.deductions === 'number' && args.deductions >= 0));

class WageCalculatorServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'wage-calculator-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

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
          description: 'Calculate employee wage and salary based on various factors',
          inputSchema: {
            type: 'object',
            properties: {
              base_salary: {
                type: 'number',
                description: 'Base annual or monthly salary',
                minimum: 0,
              },
              overtime_hours: {
                type: 'number',
                description: 'Overtime hours worked',
                minimum: 0,
              },
              overtime_rate: {
                type: 'number',
                description: 'Hourly rate for overtime (default: base_salary / 2080 * 1.5)',
                minimum: 0,
              },
              bonus: {
                type: 'number',
                description: 'Additional bonus payment',
                minimum: 0,
              },
              tax_rate: {
                type: 'number',
                description: 'Tax rate (0-1, default: 0.2)',
                minimum: 0,
                maximum: 1,
              },
              deductions: {
                type: 'number',
                description: 'Other deductions (insurance, etc.)',
                minimum: 0,
              },
            },
            required: ['base_salary'],
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
      const baseSalary = args.base_salary;
      const overtimeHours = args.overtime_hours || 0;
      const overtimeRate = args.overtime_rate || (baseSalary / 2080) * 1.5; // Assuming 2080 working hours per year
      const bonus = args.bonus || 0;
      const taxRate = args.tax_rate !== undefined ? args.tax_rate : 0.2;
      const deductions = args.deductions || 0;

      // Calculate gross salary
      const overtimePay = overtimeHours * overtimeRate;
      const grossSalary = baseSalary + overtimePay + bonus;
      
      // Calculate tax and net salary
      const taxAmount = grossSalary * taxRate;
      const netSalary = grossSalary - taxAmount - deductions;

      const result = {
        gross_salary: grossSalary,
        overtime_pay: overtimePay,
        bonus: bonus,
        tax_amount: taxAmount,
        deductions: deductions,
        net_salary: netSalary,
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
