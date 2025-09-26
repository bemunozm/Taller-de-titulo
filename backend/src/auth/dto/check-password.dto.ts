import { IsString, MinLength } from 'class-validator';

export class CheckPasswordDto {
    @IsString()
    @MinLength(6)
    password: string;
}