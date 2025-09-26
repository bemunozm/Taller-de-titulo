import { IsEmail } from 'class-validator';

export class RequestConfirmationCodeDto {
    @IsEmail()
    email: string;
}