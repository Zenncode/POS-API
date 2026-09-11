import mongoose, { Document, Schema } from 'mongoose';

export interface AdminDocument extends Document {
  email: string;
  passwordHash: string;
  refreshTokenHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSchema = new Schema<AdminDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    refreshTokenHash: { type: String, default: null },
  },
  { timestamps: true, collection: 'admins' },
);

export const AdminModel = mongoose.model<AdminDocument>('Admin', AdminSchema);
