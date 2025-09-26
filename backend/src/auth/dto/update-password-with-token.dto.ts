import { IsString, MinLength, MaxLength } from 'class-validator';

export class UpdatePasswordWithTokenDto {
    @IsString()
    @MinLength(6)
    @MaxLength(6)
    token: string;

    @IsString()
    @MinLength(6)
    password: string;
}