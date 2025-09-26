import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePermissionDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(100)
    name: string;

    @IsNotEmpty()
    @IsString()
    @MaxLength(255)
    description: string;

    @IsNotEmpty()
    @IsString()
    @MaxLength(50)
    module: string;

    @IsNotEmpty()
    @IsString()
    @MaxLength(50)
    action: string;
}