import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Country } from '@prisma/client';

@Injectable()
export class CountryService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<Country[]> {
    return this.prisma.country.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findOrCreate(name: string, isoCode?: string): Promise<Country> {
    const existing = await this.prisma.country.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });

    if (existing) return existing;

    return this.prisma.country.create({
      data: {
        name,
        isoCode: isoCode || null,
      },
    });
  }
}
