import { Request, Response } from 'express';
import { loginAdmin, refreshAdminSession, logoutAdmin } from '../services/auth.service';

export async function loginAdminController(req: Request, res: Response): Promise<Response> {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const tokens = await loginAdmin({ email, password });
    return res.status(200).json(tokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    return res.status(401).json({ message });
  }
}

export async function refreshAdminController(req: Request, res: Response): Promise<Response> {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token is required' });
  }

  try {
    const tokens = await refreshAdminSession(refreshToken);
    return res.status(200).json(tokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token refresh failed';
    return res.status(401).json({ message });
  }
}

export async function logoutAdminController(req: Request, res: Response): Promise<Response> {
  if (!req.admin?.id) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    await logoutAdmin(req.admin.id);
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Logout failed';
    return res.status(500).json({ message });
  }
}
