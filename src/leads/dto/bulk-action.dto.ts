import { IsArray, IsString, IsNotEmpty, ArrayNotEmpty, IsOptional } from 'class-validator';

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

export class BulkEditDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  leadIds!: string[];

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  tagAction?: 'ADD' | 'REMOVE' | 'SET';
}

