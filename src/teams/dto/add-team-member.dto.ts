import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class AddTeamMemberDto {
  @IsString()
  @IsNotEmpty({ message: 'User ID is required' })
  @Transform(({ value }: { value: string }) => value?.trim())
  userId!: string;
}
