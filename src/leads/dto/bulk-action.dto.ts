import { IsArray, IsString, IsNotEmpty, ArrayNotEmpty } from 'class-validator';

export class BulkAssignDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  leadIds!: string[];

  @IsString()
  @IsNotEmpty()
  ownerId!: string;
}

export class BulkUpdateStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  leadIds!: string[];

  @IsString()
  @IsNotEmpty()
  statusId!: string;
}

export class BulkDeleteDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  leadIds!: string[];
}

export class BulkTagDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  leadIds!: string[];

  @IsString()
  @IsNotEmpty()
  tag!: string;

  @IsString()
  @IsNotEmpty()
  action!: 'ADD' | 'REMOVE' | 'SET';
}

