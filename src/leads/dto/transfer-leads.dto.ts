import { IsArray, IsNotEmpty, IsOptional, IsString, ArrayMinSize } from 'class-validator';

export class TransferLeadsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: 'At least one lead ID must be provided for transfer' })
  leadIds: string[];

  @IsString()
  @IsNotEmpty({ message: 'Destination user ID is required' })
  toUserId: string;

  @IsOptional()
  @IsString()
  fromUserId?: string;
}
