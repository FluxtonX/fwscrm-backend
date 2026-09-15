import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
}
