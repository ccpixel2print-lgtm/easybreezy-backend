import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  ping() {
    return { ok: true, module: 'auth' };
  }

  // ---- Customer OTP: request ----
  async requestOtp(rawEmail: string) {
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('A valid email is required.');
    }

    // Find or create the customer user
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email, role: 'CUSTOMER' },
      });
    }

    // Generate a 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);

    const expiryMins = Number(this.config.get('OTP_EXPIRY_MINUTES') ?? 10);
    const expiresAt = new Date(Date.now() + expiryMins * 60 * 1000);

    // Invalidate any previous unconsumed login OTPs for this user
    await this.prisma.otpToken.updateMany({
      where: { userId: user.id, purpose: 'login', consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.otpToken.create({
      data: { userId: user.id, codeHash, purpose: 'login', expiresAt },
    });

    // TODO (later step): send `code` via email provider.
    // For now, log it to the backend console so we can test.
    console.log(`\n========================================`);
    console.log(`  OTP for ${email}: ${code}`);
    console.log(`  (expires in ${expiryMins} minutes)`);
    console.log(`========================================\n`);

    return { sent: true, message: 'OTP sent to your email.' };
  }

  // ---- Customer OTP: verify ----
  async verifyOtp(rawEmail: string, code: string) {
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!email || !code) {
      throw new BadRequestException('Email and OTP code are required.');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid email or code.');
    }

    // Get the latest unconsumed, unexpired login OTP
    const token = await this.prisma.otpToken.findFirst({
      where: {
        userId: user.id,
        purpose: 'login',
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) {
      throw new UnauthorizedException('Code expired or not found. Please request a new one.');
    }

    if (token.attempts >= 5) {
      throw new UnauthorizedException('Too many attempts. Please request a new code.');
    }

    const matches = await bcrypt.compare(code, token.codeHash);
    if (!matches) {
      await this.prisma.otpToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid code.');
    }

    // Success: consume the token and mark email verified
    await this.prisma.otpToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });
    if (!user.emailVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    const accessToken = this.signToken(user.id, user.email, user.role);
    return {
      accessToken,
      user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
    };
  }

  // ---- Staff login (email + password) ----
  async staffLogin(rawEmail: string, password: string) {
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!email || !password) {
      throw new BadRequestException('Email and password are required.');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    // Only staff roles may use password login
    const staffRoles = ['EMPLOYEE', 'SUPERVISOR', 'ADMIN'];
    if (!user || !user.passwordHash || !staffRoles.includes(user.role)) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active.');
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const accessToken = this.signToken(user.id, user.email, user.role);
    return {
      accessToken,
      user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
    };
  }

  // ---- Fetch current user (for /me) ----
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, fullName: true, phone: true, status: true },
    });
    if (!user) throw new UnauthorizedException('User not found.');
    return user;
  }

  private signToken(userId: string, email: string, role: string) {
    return this.jwt.sign({ sub: userId, email, role });
  }
}
