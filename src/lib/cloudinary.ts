import { v2 as cloudinary } from "cloudinary";

let configured = false;

export function hasCloudinaryEnv() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

export function getCloudinary() {
  if (!hasCloudinaryEnv()) {
    throw new Error("Missing Cloudinary environment variables");
  }

  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }

  return cloudinary;
}

export async function uploadBufferToCloudinary(input: {
  buffer: Buffer;
  folder: string;
  publicId: string;
  resourceType: "image" | "raw" | "video";
  mimeType?: string;
  originalFilename?: string;
}) {
  const sdk = getCloudinary();

  return new Promise<any>((resolve, reject) => {
    const stream = sdk.uploader.upload_stream(
      {
        folder: input.folder,
        public_id: input.publicId,
        resource_type: input.resourceType,
        overwrite: false,
        invalidate: false,
        use_filename: false,
        unique_filename: false,
        filename_override: input.originalFilename,
        format: undefined,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      },
    );

    stream.end(input.buffer);
  });
}
