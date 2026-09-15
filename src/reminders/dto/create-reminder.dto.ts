import { IsNotEmpty, IsString, MaxLength, IsISO8601, IsOptional } from 'class-validator';

export class CreateReminderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

  @IsISO8601()
  @IsNotEmpty()
  dueDate: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;
}
