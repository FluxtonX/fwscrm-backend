import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class AcceptInvitationDto {
  @IsNotEmpty({ message: 'Invitation token is required' })
  @IsString()
  token: string;

  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @IsNotEmpty({ message: 'First name is required' })
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim())
  firstName: string;

  @IsNotEmpty({ message: 'Last name is required' })
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim())
  lastName: string;
}
