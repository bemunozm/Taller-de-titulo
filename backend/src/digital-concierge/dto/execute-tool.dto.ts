import { IsString, IsObject, IsNotEmpty } from 'class-validator';

export class ExecuteToolDto {
  @IsNotEmpty()
  @IsString()
  toolName: string;

  @IsNotEmpty()
  @IsObject()
  parameters: Record<string, any>;
}

export class ToolResultDto {
  success: boolean;
  data?: any;
  error?: string;
}
