import { IsBoolean, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateReminderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  @IsOptional()
  @IsString()
  assignedUserId?: string;
}
