using System;
using System.Drawing;
using System.Windows.Forms;
class Program {
    static void Main() {
        var bmp = new Bitmap(Screen.PrimaryScreen.Bounds.Width, Screen.PrimaryScreen.Bounds.Height);
        using (var g = Graphics.FromImage(bmp)) {
            g.CopyFromScreen(Point.Empty, Point.Empty, bmp.Size);
        }
        bmp.Save(@"C:\Users\Lenovo\Desktop\APP\screen_capture.png", System.Drawing.Imaging.ImageFormat.Png);
    }
}
