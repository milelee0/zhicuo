package com.zhicuo.app.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

object ImageUtils {
    private const val MAX_SIDE = 1600

    fun imageDir(context: Context): File {
        val dir = File(context.filesDir, "images")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    fun newCameraFile(context: Context): File {
        val dir = File(context.cacheDir, "images")
        if (!dir.exists()) dir.mkdirs()
        return File(dir, "camera_${System.currentTimeMillis()}.jpg")
    }

    fun uriFor(context: Context, file: File): Uri =
        FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

    fun saveFromUri(context: Context, uri: Uri): File? {
        val temp = File(context.cacheDir, "import_${System.currentTimeMillis()}.jpg")
        return runCatching {
            context.contentResolver.openInputStream(uri)?.use { input ->
                temp.outputStream().use { output -> input.copyTo(output) }
            }
            compressToNewFile(temp, imageDir(context))
        }.getOrNull()
    }

    fun compressCameraFile(context: Context, source: File): File? {
        val result = compressToNewFile(source, imageDir(context))
        source.delete()
        return result
    }

    fun compressToNewFile(source: File, targetDir: File): File? {
        if (!targetDir.exists()) targetDir.mkdirs()
        val bitmap = runCatching { BitmapFactory.decodeFile(source.absolutePath) }.getOrNull() ?: return null
        val scaled = scaleDown(bitmap, MAX_SIDE)
        val out = File(targetDir, "q_${System.currentTimeMillis()}.jpg")
        FileOutputStream(out).use { stream ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 86, stream)
        }
        if (scaled !== bitmap) scaled.recycle()
        bitmap.recycle()
        return out
    }

    fun loadSampled(path: String, maxSide: Int = 1200): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > maxSide || bounds.outHeight / sample > maxSide) {
            sample *= 2
        }
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeFile(path, options)
    }

    private fun scaleDown(bitmap: Bitmap, maxSide: Int): Bitmap {
        val max = maxOf(bitmap.width, bitmap.height)
        if (max <= maxSide) return bitmap
        val ratio = maxSide.toFloat() / max
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * ratio).toInt().coerceAtLeast(1),
            (bitmap.height * ratio).toInt().coerceAtLeast(1),
            true
        )
    }
}
