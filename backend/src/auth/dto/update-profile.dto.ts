import { IsString, IsEmail, MinLength } from 'class-validator';

export class UpdateProfileDto {
    @IsString()
    @MinLength(1)
    name: string;

    @IsEmail()
    email: string;
}