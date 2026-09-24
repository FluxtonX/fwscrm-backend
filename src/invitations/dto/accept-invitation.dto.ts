import {
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty({ message: 'Invitation token is required' })
  @Transform(({ value }: { value: string }) => value?.trim())
  token!: string;

  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  firstName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  lastName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Confirm password is required' })
  confirmPassword!: string;
}
