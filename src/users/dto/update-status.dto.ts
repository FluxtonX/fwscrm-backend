import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateUserStatusDto {
  @IsBoolean()
  @IsNotEmpty({ message: 'isActive boolean flag is required' })
  isActive: boolean;
}
