import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ConfirmAccountDto } from "./dto/confirm-account.dto";
import { RequestConfirmationCodeDto } from "./dto/request-confirmation-code.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ValidateTokenDto } from "./dto/validate-token.dto";
import { UpdatePasswordWithTokenDto } from "./dto/update-password-with-token.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UpdateCurrentUserPasswordDto } from "./dto/update-current-user-password.dto";
import { CheckPasswordDto } from "./dto/check-password.dto";
import { AuthEmailService } from "./services/auth-email.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authEmailService: AuthEmailService
  ) {}

  @Post("create-account")
  createAccount(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post("confirm-account")
  confirmAccount(@Body() confirmAccountDto: ConfirmAccountDto) {
    return this.authService.confirmAccount(confirmAccountDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post("login")
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post("request-code")
  requestConfirmationCode(@Body() requestConfirmationCodeDto: RequestConfirmationCodeDto) {
    return this.authService.requestConfirmationCode(requestConfirmationCodeDto);
  }

  @Post("forgot-password")
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post("validate-token")
  validateToken(@Body() validateTokenDto: ValidateTokenDto) {
    return this.authService.validateToken(validateTokenDto);
  }

  @Post("update-password")
  updatePasswordWithToken(@Body() updatePasswordWithTokenDto: UpdatePasswordWithTokenDto) {
    return this.authService.updatePasswordWithToken(updatePasswordWithTokenDto);
  }

  @Get('user')
  @UseGuards(AuthGuard)
  getUser(@Request() req) {
    return this.authService.getUser(req.user.id);
  }

  @Post('profile')
  @UseGuards(AuthGuard)
  updateProfile(@Request() req, @Body() updateProfileDto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.id, updateProfileDto);
  }

  @Post('update-password')
  @UseGuards(AuthGuard)
  updateCurrentUserPassword(@Request() req, @Body() updateCurrentUserPasswordDto: UpdateCurrentUserPasswordDto) {
    return this.authService.updateCurrentUserPassword(req.user.id, updateCurrentUserPasswordDto);
  }

  @Post('check-password')
  @UseGuards(AuthGuard)
  checkPassword(@Request() req, @Body() checkPasswordDto: CheckPasswordDto) {
    return this.authService.checkPassword(req.user.id, checkPasswordDto);
  }

  // Endpoint temporal para probar el envío de emails
  @Get('test-email')
  async testEmail() {
    try {
      await this.authEmailService.sendConfirmationEmail({
        email: 'test@example.com',
        name: 'Usuario de Prueba',
        token: '123456'
      });
      return { message: 'Email de prueba enviado correctamente' };
    } catch (error) {
      return { error: 'Error al enviar email', details: error.message };
    }
  }
}