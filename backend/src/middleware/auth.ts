import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'krafiler-dev-secret-change-in-production';

export interface AuthRequest extends Request {
    employee?: {
        id: number;
        clientId: number;
        kraPin: string;
        employeeName: string;
        email: string;
    };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ message: 'Authentication required' });
        return;
    }

    const token = authHeader.slice(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.employee = {
            id: decoded.id,
            clientId: decoded.clientId,
            kraPin: decoded.kraPin,
            employeeName: decoded.employeeName,
            email: decoded.email,
        };
        next();
    } catch {
        res.status(401).json({ message: 'Invalid or expired token' });
    }
}

export function signToken(employee: {
    id: number;
    clientId: number;
    kraPin: string;
    employeeName: string;
    email: string;
}): string {
    return jwt.sign(employee, JWT_SECRET, { expiresIn: '7d' });
}
