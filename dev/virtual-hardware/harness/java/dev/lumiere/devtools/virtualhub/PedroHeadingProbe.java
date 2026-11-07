package dev.lumiere.devtools.virtualhub;

import static com.pedropathing.api.Paths.curve;
import static com.pedropathing.api.Paths.line;
import static org.junit.Assume.assumeTrue;

import com.pedropathing.follower.Follower;
import com.pedropathing.math.Pose;
import com.pedropathing.math.Vector2D;
import com.pedropathing.paths.Path;

import dev.lumiere.ftc.Headings;

import org.junit.Test;

import java.util.Locale;

/**
 * Prints how headings come out under whichever Pedro Pathing version is on the class path, for
 * comparing versions (virtual-hub.mjs --probe --pedro 3.0.2). It asserts nothing.
 *
 * <p>"Intended" is what each interpolator documents: linear headings turn in proportion to distance
 * travelled, and facing-point headings aim from the robot's position on the curve.
 */
public class PedroHeadingProbe {
    private static final double[] PARAMETERS = {0.0, 0.25, 0.5, 0.75, 1.0};

    @Test
    public void report() {
        assumeTrue("Started by dev/virtual-hardware", System.getProperty("vh.probe") != null);
        print("Pedro Pathing %s", pedroVersion());

        Pose a = new Pose(24, 24, Math.toRadians(0));
        Pose b = new Pose(120, 24, Math.toRadians(90));
        Pose start = new Pose(24, 72, Math.toRadians(0));
        Pose control = new Pose(30, 130, 0);
        Pose end = new Pose(120, 96, Math.toRadians(90));

        print("");
        print("1. Line, Pedro's own linear heading (0 to 90 deg)");
        table(line(a, b).linear(a, b), 0, 90, null);
        print("2. Line, Headings.linear (0 to 90 deg)");
        table(line(a, b).heading(Headings.linear(a, b)), 0, 90, null);
        print("3. Curve, Pedro's own linear heading (0 to 90 deg)");
        table(curve(start, control, end).linear(start, end), 0, 90, null);
        print("4. Curve, Headings.linear (0 to 90 deg)");
        table(curve(start, control, end).heading(Headings.linear(start, end)), 0, 90, null);
        print("5. Curve, Headings.piecewise facing (72, 72) for the whole path");
        table(curve(start, control, end).heading(Headings.piecewise().facingPoint(0, 1, 72, 72).build()), 0, 0, Vector2D.cartesian(72, 72));
        print("6. Curve, Pedro's own facingPoint (72, 72)");
        table(curve(start, control, end).facingPoint(Vector2D.cartesian(72, 72)), 0, 0, Vector2D.cartesian(72, 72));
        print("7. Curve, Pedro's own tangent");
        table(curve(start, control, end).tangent(), (path, t, travelled) -> tangentDegrees(path, t));
        print("8. Curve, Pedro's own reverseTangent");
        table(curve(start, control, end).reverseTangent(), (path, t, travelled) -> tangentDegrees(path, t) + 180);
        print("9. Curve, Headings.linear(...).reverse() (180 to 270 deg)");
        table(curve(start, control, end).heading(Headings.linear(start, end).reverse()), (path, t, travelled) -> 180 + 90 * travelled);
        print("10. Curve, Headings.piecewise reverse tangent for the whole path");
        table(curve(start, control, end).heading(Headings.piecewise().tangent(0, 1, true).build()), (path, t, travelled) -> tangentDegrees(path, t) + 180);
    }

    /** The heading each row expects at curve parameter t, given the fraction of distance travelled. */
    private interface Intended {
        double degrees(Path path, double t, double travelled);
    }

    private static double tangentDegrees(Path path, double t) {
        return Math.toDegrees(path.curve.derivative(t).theta());
    }

    private static void table(Path path, final double startDegrees, final double endDegrees, final Vector2D target) {
        table(path, (p, t, travelled) -> {
            if (target == null) return startDegrees + (endDegrees - startDegrees) * travelled;
            Pose at = p.get(t);
            return Math.toDegrees(Math.atan2(target.y() - at.y(), target.x() - at.x()));
        });
    }

    private static void table(Path path, Intended expected) {
        print("   t      travelled  heading    intended   error (deg)");
        double worst = 0;
        for (double t : PARAMETERS) {
            double travelled = Headings.completion(path.curve, t);
            double intended = expected.degrees(path, t, travelled);
            double heading = Math.toDegrees(path.heading(t));
            double error = wrap(heading - intended);
            worst = Math.max(worst, Math.abs(error));
            print("   %.2f   %5.1f%%     %7.2f    %7.2f    %+6.2f", t, travelled * 100, wrap(heading), wrap(intended), error);
        }
        print("   worst error %.2f deg%n", worst);
    }

    private static double wrap(double degrees) {
        double value = degrees % 360;
        if (value > 180) value -= 360;
        if (value <= -180) value += 360;
        return value;
    }

    private static String pedroVersion() {
        Package pkg = Follower.class.getPackage();
        String version = pkg == null ? null : pkg.getImplementationVersion();
        if (version != null) return version;
        String location = String.valueOf(Follower.class.getProtectionDomain().getCodeSource().getLocation());
        java.util.regex.Matcher match = java.util.regex.Pattern.compile("core[-/](\\d+\\.\\d+\\.\\d+)").matcher(location);
        return match.find() ? match.group(1) : "(unknown: " + location + ")";
    }

    private static void print(String format, Object... args) {
        System.out.println("[probe] " + String.format(Locale.ROOT, format, args));
        System.out.flush();
    }
}
