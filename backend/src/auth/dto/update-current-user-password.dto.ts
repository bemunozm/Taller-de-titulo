import { IsString, MinLength } from 'class-validator';

export class UpdateCurrentUserPasswordDto {
    @IsString()
    @MinLength(6)
    current_password: string;

    @IsString()
    @MinLength(6)
    password: string;
}