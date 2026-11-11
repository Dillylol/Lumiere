package org.firstinspires.ftc.teamcode.lumieretest;

import com.pedropathing.algorithm.Algorithm;
import com.pedropathing.drivetrain.Drivetrain;
import com.pedropathing.follower.Follower;
import com.pedropathing.localization.Localizer;
import com.pedropathing.math.Pose;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;

/**
 * Stand-ins for a team's own code, in a team package as real OpModes are: the robot library searches
 * team objects for followers, and never its own.
 */
public final class TeamCode {
    private TeamCode() {
    }

    /** A team's own class holding its follower, as many teams keep one in a robot object. */
    public static final class TeamRobot {
        public final Follower follower = follower(10, 20, 1.5);
    }

    /** A team OpMode that doesn't report through Session. */
    public static final class TeamAuto extends OpMode {
        public final TeamRobot robot = new TeamRobot();
        // Library objects are not searched, even when they hold a follower.
        final List<Object> list = new ArrayList<>(List.of(follower(99, 99, 0)));

        @Override public void init() { }
        @Override public void loop() { }
    }

    /** A follower kept in a static field. */
    public static final class StaticHolder {
        public static final Follower SHARED = follower(1, 2, 3);
    }

    /** Holds a {@link StaticHolder}, so its static follower can be reached. */
    public static final class Holder {
        final StaticHolder held = new StaticHolder();
    }

    /** A real Pedro Pathing follower whose localizer always reports this pose. */
    public static Follower follower(double x, double y, double heading) {
        Localizer localizer = (Localizer) Proxy.newProxyInstance(TeamCode.class.getClassLoader(), new Class<?>[]{Localizer.class},
                (proxy, method, args) -> "pose".equals(method.getName()) ? new Pose(x, y, heading) : zero(method.getReturnType(), proxy, method.getName(), args));
        Drivetrain drivetrain = (Drivetrain) Proxy.newProxyInstance(TeamCode.class.getClassLoader(), new Class<?>[]{Drivetrain.class},
                (proxy, method, args) -> zero(method.getReturnType(), proxy, method.getName(), args));
        Algorithm algorithm = (Algorithm) Proxy.newProxyInstance(TeamCode.class.getClassLoader(), new Class<?>[]{Algorithm.class},
                (proxy, method, args) -> zero(method.getReturnType(), proxy, method.getName(), args));
        return new Follower(localizer, drivetrain, algorithm);
    }

    /** What a stand-in returns for anything the test doesn't care about. */
    public static Object zero(Class<?> type, Object proxy, String name, Object[] args) {
        if ("hashCode".equals(name)) return System.identityHashCode(proxy);
        if ("equals".equals(name)) return proxy == args[0];
        if ("toString".equals(name)) return "stand-in";
        if (type == boolean.class) return false;
        if (type == double.class) return 0.0;
        if (type == int.class) return 0;
        if (type == long.class) return 0L;
        return null;
    }
}
